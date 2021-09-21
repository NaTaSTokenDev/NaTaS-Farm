import { FA12 } from "./helpers/FA12";
import { FA2 } from "./helpers/FA2";
import { Utils, zeroAddress } from "./helpers/Utils";
import { TFarm, TFarmUtils } from "./helpers/TFarm";
import { Burner } from "./helpers/Burner";
import { BakerRegistry } from "./helpers/BakerRegistry";
import { QSFA12Factory } from "./helpers/QSFA12Factory";
import { QSFA2Factory } from "./helpers/QSFA2Factory";

import { UpdateOperatorParam, UserFA2Info, UserFA2LPInfo } from "./types/FA2";
import {
  WithdrawFarmDepoParams,
  NewFarmParams,
  SetFeeParams,
  FarmData,
  Farm,
} from "./types/TFarm";
import {
  PauseFarmParam,
  WithdrawParams,
  DepositParams,
  HarvestParams,
  UserInfoType,
  WithdrawData,
} from "./types/Common";
import { UserFA12Info } from "./types/FA12";
import { QSFA12Dex } from "./helpers/QSFA12Dex";
import { QSFA2Dex } from "./helpers/QSFA2Dex";

import { ok, rejects, strictEqual } from "assert";

import { BigNumber } from "bignumber.js";

import { alice, bob, dev } from "../scripts/sandbox/accounts";

import { confirmOperation } from "../scripts/confirmation";

import { fa12Storage } from "../storage/test/FA12";
import { fa2Storage } from "../storage/test/FA2";
import { tFarmStorage } from "../storage/TFarm";
import { burnerStorage } from "../storage/Burner";
import { bakerRegistryStorage } from "../storage/BakerRegistry";
import { qsFA12FactoryStorage } from "../storage/test/QSFA12Factory";
import { qsFA2FactoryStorage } from "../storage/test/QSFA2Factory";

describe("TFarm tests", async () => {
  var fa12: FA12;
  var fa12LP: QSFA12Dex;
  var fa2: FA2;
  var fa2LP: QSFA2Dex;
  var qsGov: FA2;
  var qsGovLP: QSFA2Dex;
  var utils: Utils;
  var tFarm: TFarm;
  var burner: Burner;
  var bakerRegistry: BakerRegistry;
  var qsFA12Factory: QSFA12Factory;
  var qsFA2Factory: QSFA2Factory;

  var precision = 10 ** 18;
  var feePrecision = 10 ** 2;

  before("setup", async () => {
    utils = new Utils();

    await utils.init(alice.sk);

    fa12 = await FA12.originate(utils.tezos, fa12Storage);
    fa2 = await FA2.originate(utils.tezos, fa2Storage);
    qsGov = await FA2.originate(utils.tezos, fa2Storage);

    bakerRegistry = await BakerRegistry.originate(
      utils.tezos,
      bakerRegistryStorage
    );

    qsFA12FactoryStorage.baker_validator = bakerRegistry.contract.address;

    qsFA12Factory = await QSFA12Factory.originate(
      utils.tezos,
      qsFA12FactoryStorage
    );

    qsFA2FactoryStorage.baker_validator = bakerRegistry.contract.address;

    qsFA2Factory = await QSFA2Factory.originate(
      utils.tezos,
      qsFA2FactoryStorage
    );

    await qsFA12Factory.setDexAndTokenLambdas();
    await qsFA2Factory.setDexAndTokenLambdas();

    const updateOperatorParam: UpdateOperatorParam = {
      add_operator: {
        owner: alice.pkh,
        operator: qsFA2Factory.contract.address,
        token_id: 0,
      },
    };

    await qsGov.updateOperators([updateOperatorParam]);
    await qsFA2Factory.launchExchange(qsGov.contract.address, 0, 10000, 10000);
    await qsFA2Factory.updateStorage({
      token_to_exchange: [[qsGov.contract.address, 0]],
    });

    const qsGovLPAddress = await qsFA2Factory.storage.token_to_exchange[
      `${qsGov.contract.address},${0}`
    ];

    await fa2.updateOperators([updateOperatorParam]);
    await qsFA2Factory.launchExchange(fa2.contract.address, 0, 10000, 10000);
    await qsFA2Factory.updateStorage({
      token_to_exchange: [[fa2.contract.address, 0]],
    });

    const fa2LPAddress: string =
      qsFA2Factory.storage.token_to_exchange[`${fa2.contract.address},${0}`];

    await fa12.approve(qsFA12Factory.contract.address, 10000);
    await qsFA12Factory.launchExchange(fa12.contract.address, 10000, 10000);
    await qsFA12Factory.updateStorage({
      token_to_exchange: [fa12.contract.address],
    });

    const fa12LPAddress: string =
      qsFA12Factory.storage.token_to_exchange[fa12.contract.address];

    fa12LP = await QSFA12Dex.init(fa12LPAddress, utils.tezos);
    fa2LP = await QSFA2Dex.init(fa2LPAddress, utils.tezos);
    qsGovLP = await QSFA2Dex.init(qsGovLPAddress, utils.tezos);

    burnerStorage.qsgov_lp = qsGovLPAddress;
    burnerStorage.qsgov.token = qsGov.contract.address;
    burnerStorage.qsgov.id = 0;

    tFarmStorage.storage.qsgov.token = qsGov.contract.address;
    tFarmStorage.storage.qsgov.id = 0;
    tFarmStorage.storage.qsgov_lp = qsGovLPAddress;
    tFarmStorage.storage.admin = alice.pkh;
    tFarmStorage.storage.pending_admin = zeroAddress;
    tFarmStorage.storage.burner = zeroAddress;
    tFarmStorage.storage.baker_registry = zeroAddress;
    tFarmStorage.storage.farms_count = 0;

    burner = await Burner.originate(utils.tezos, burnerStorage);
    tFarm = await TFarm.originate(utils.tezos, tFarmStorage);

    await tFarm.setLambdas();
  });

  it("should fail if not admin is trying to setup new pending admin", async () => {
    await utils.setProvider(bob.sk);
    await rejects(tFarm.setAdmin(bob.pkh), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should setup new pending admin by admin", async () => {
    await utils.setProvider(alice.sk);
    await tFarm.setAdmin(bob.pkh);
    await tFarm.updateStorage();

    strictEqual(tFarm.storage.storage.admin, alice.pkh);
    strictEqual(tFarm.storage.storage.pending_admin, bob.pkh);
  });

  it("should fail if not pending admin is trying to confirm new admin", async () => {
    await rejects(tFarm.confirmAdmin(), (err: Error) => {
      ok(err.message === "Not-pending-admin");

      return true;
    });
  });

  it("should confirm new admin by pending admin", async () => {
    await utils.setProvider(bob.sk);
    await tFarm.confirmAdmin();
    await tFarm.updateStorage();

    strictEqual(tFarm.storage.storage.admin, bob.pkh);
    strictEqual(tFarm.storage.storage.pending_admin, zeroAddress);
  });

  it("should fail if not admin is trying to set burner", async () => {
    const burnerAddress: string = burner.contract.address;

    await utils.setProvider(alice.sk);
    await rejects(tFarm.setBurner(burnerAddress), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should change burner by admin", async () => {
    const burnerAddress: string = burner.contract.address;

    await utils.setProvider(bob.sk);
    await tFarm.updateStorage();

    strictEqual(tFarm.storage.storage.burner, zeroAddress);

    await tFarm.setBurner(burnerAddress);
    await tFarm.updateStorage();

    strictEqual(tFarm.storage.storage.burner, burnerAddress);
  });

  it("should fail if not admin is trying to set baker registry", async () => {
    const bakerRegistryAddress: string = bakerRegistry.contract.address;

    await utils.setProvider(alice.sk);
    await rejects(
      tFarm.setBakerRegistry(bakerRegistryAddress),
      (err: Error) => {
        ok(err.message === "Not-admin");

        return true;
      }
    );
  });

  it("should change baker registry by admin", async () => {
    const bakerRegistryAddress: string = bakerRegistry.contract.address;

    await utils.setProvider(bob.sk);
    await tFarm.updateStorage();

    strictEqual(tFarm.storage.storage.baker_registry, zeroAddress);

    await tFarm.setBakerRegistry(bakerRegistryAddress);
    await tFarm.updateStorage();

    strictEqual(tFarm.storage.storage.baker_registry, bakerRegistryAddress);
  });

  it("should fail if not admin is trying to add new farm", async () => {
    const newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );

    await utils.setProvider(alice.sk);
    await rejects(tFarm.addNewFarm(newFarmParams), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should fail if end time is less or equal to start time", async () => {
    const newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );

    await utils.setProvider(bob.sk);
    await rejects(tFarm.addNewFarm(newFarmParams), (err: Error) => {
      ok(err.message === "TFarm/wrong-end-time");

      return true;
    });
  });

  it("should fail if timelock is more than farm's lifetime", async () => {
    const newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 10; // 10 seconds

    newFarmParams.timelock = 20;
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );

    await rejects(tFarm.addNewFarm(newFarmParams), (err: Error) => {
      ok(err.message === "TFarm/wrong-timelock");

      return true;
    });
  });

  it("should add new farm by admin and set all farm's fields correctly", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 600; // 10 minutes

    newFarmParams.fees.harvest_fee = 10 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 15 * feePrecision;
    newFarmParams.stake_params.staked_token = {
      fA2: { token: qsGov.contract.address, id: 0 },
    };
    newFarmParams.stake_params.qs_pool = qsGovLP.contract.address;
    newFarmParams.reward_token = { fA12: fa12.contract.address };
    newFarmParams.timelock = 10;
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );
    newFarmParams.reward_per_second = 1 * precision;

    await fa12.approve(
      tFarm.contract.address,
      (lifetime * newFarmParams.reward_per_second) / precision
    );
    await tFarm.addNewFarm(newFarmParams);
    await tFarm.updateStorage({ farms: [0] });

    strictEqual(+tFarm.storage.storage.farms_count, 1);

    strictEqual(
      +tFarm.storage.storage.farms[0].fees.harvest_fee,
      newFarmParams.fees.harvest_fee
    );
    strictEqual(
      +tFarm.storage.storage.farms[0].fees.withdrawal_fee,
      newFarmParams.fees.withdrawal_fee
    );
    strictEqual(
      tFarm.storage.storage.farms[0].stake_params.staked_token.fA2.token,
      newFarmParams.stake_params.staked_token.fA2.token
    );
    strictEqual(
      +tFarm.storage.storage.farms[0].stake_params.staked_token.fA2.id,
      newFarmParams.stake_params.staked_token.fA2.id
    );
    strictEqual(
      tFarm.storage.storage.farms[0].stake_params.is_lp_staked_token,
      newFarmParams.stake_params.is_lp_staked_token
    );
    strictEqual(
      tFarm.storage.storage.farms[0].stake_params.token.fA12,
      newFarmParams.stake_params.token.fA12
    );
    strictEqual(
      tFarm.storage.storage.farms[0].stake_params.qs_pool,
      newFarmParams.stake_params.qs_pool
    );
    strictEqual(
      tFarm.storage.storage.farms[0].reward_token.fA12,
      newFarmParams.reward_token.fA12
    );
    strictEqual(
      +tFarm.storage.storage.farms[0].timelock,
      newFarmParams.timelock
    );
    strictEqual(tFarm.storage.storage.farms[0].current_delegated, zeroAddress);
    strictEqual(tFarm.storage.storage.farms[0].current_candidate, zeroAddress);
    strictEqual(tFarm.storage.storage.farms[0].paused, newFarmParams.paused);
    strictEqual(
      +tFarm.storage.storage.farms[0].reward_per_second,
      newFarmParams.reward_per_second
    );
    strictEqual(+tFarm.storage.storage.farms[0].rps, 0);
    strictEqual(+tFarm.storage.storage.farms[0].staked, 0);
    strictEqual(+tFarm.storage.storage.farms[0].fid, 0);

    ok(
      Date.parse(tFarm.storage.storage.farms[0].upd) >=
        +newFarmParams.start_time * 1000
    );
    ok(
      Date.parse(tFarm.storage.storage.farms[0].start_time) >=
        +newFarmParams.start_time * 1000
    );
    ok(
      Date.parse(tFarm.storage.storage.farms[0].end_time) >
        +newFarmParams.start_time * 1000
    );

    await utils.setProvider(alice.sk);

    const depositParams: DepositParams = {
      fid: 0,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };
    const updateOperatorParam: UpdateOperatorParam = {
      add_operator: {
        owner: alice.pkh,
        operator: tFarm.contract.address,
        token_id: 0,
      },
    };

    await qsGov.updateOperators([updateOperatorParam]);
    await tFarm.deposit(depositParams);
  });

  it("should transfer correct amount of FA1.2 tokens to the contract as the rewards for users", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 120; // 2 minutes

    newFarmParams.reward_token = { fA12: fa12.contract.address };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );
    newFarmParams.reward_per_second = 2 * precision;

    await fa12.updateStorage({ ledger: [tFarm.contract.address, bob.pkh] });

    const bobInitialBalance: number = +fa12.storage.ledger[bob.pkh].balance;
    const rewardsAmount: number =
      (lifetime * newFarmParams.reward_per_second) / precision;

    await utils.setProvider(bob.sk);
    await fa12.approve(tFarm.contract.address, rewardsAmount);
    await tFarm.addNewFarm(newFarmParams);
    await fa12.updateStorage({ ledger: [tFarm.contract.address, bob.pkh] });

    strictEqual(
      +fa12.storage.ledger[bob.pkh].balance,
      bobInitialBalance - rewardsAmount
    );
    strictEqual(
      +fa12.storage.ledger[tFarm.contract.address].balance,
      rewardsAmount + 600 // 600 from the previous test
    );
  });

  it("should transfer correct amount of FA2 tokens to the contract as the rewards for users", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 300; // 5 minutes

    newFarmParams.fees.harvest_fee = 4.2 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 5 * feePrecision;
    newFarmParams.stake_params.staked_token = { fA12: fa12.contract.address };
    newFarmParams.stake_params.token = { fA12: fa12.contract.address };
    newFarmParams.stake_params.qs_pool = fa12LP.contract.address;
    newFarmParams.timelock = 0;
    newFarmParams.reward_token = {
      fA2: { token: qsGov.contract.address, id: 0 },
    };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );
    newFarmParams.reward_per_second = 2 * precision;

    await qsGov.updateStorage({ account_info: [bob.pkh] });

    const bobInitialBalance: number = +(await qsGov.storage.account_info[
      bob.pkh
    ].balances.get(String(newFarmParams.reward_token.fA2.id)));
    const rewardsAmount: number =
      (lifetime * newFarmParams.reward_per_second) / precision;
    const updateOperatorParam: UpdateOperatorParam = {
      add_operator: {
        owner: bob.pkh,
        operator: tFarm.contract.address,
        token_id: newFarmParams.reward_token.fA2.id,
      },
    };

    await qsGov.updateOperators([updateOperatorParam]);
    await tFarm.addNewFarm(newFarmParams);
    await qsGov.updateStorage({
      account_info: [tFarm.contract.address, bob.pkh],
    });

    strictEqual(
      +(await qsGov.storage.account_info[bob.pkh].balances.get(
        String(newFarmParams.reward_token.fA2.id)
      )),
      bobInitialBalance - rewardsAmount
    );
    strictEqual(
      +(await qsGov.storage.account_info[tFarm.contract.address].balances.get(
        String(newFarmParams.reward_token.fA2.id)
      )),
      rewardsAmount + 100 // 100 from the previous test
    );
  });

  it("should fail if not admin is trying to set fees", async () => {
    const fees: SetFeeParams[] = [
      {
        fid: 0,
        fees: {
          harvest_fee: 15 * feePrecision,
          withdrawal_fee: 10 * feePrecision,
        },
      },
    ];

    await utils.setProvider(alice.sk);
    await rejects(tFarm.setFees(fees), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should fail if one farm from list of farms not found", async () => {
    const fees: SetFeeParams[] = [
      {
        fid: 0,
        fees: {
          harvest_fee: 15 * feePrecision,
          withdrawal_fee: 10 * feePrecision,
        },
      },
      {
        fid: 666,
        fees: {
          harvest_fee: 15 * feePrecision,
          withdrawal_fee: 10 * feePrecision,
        },
      },
    ];

    await utils.setProvider(bob.sk);
    await rejects(tFarm.setFees(fees), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should set/update fees for one farm", async () => {
    const fees: SetFeeParams[] = [
      {
        fid: 0,
        fees: {
          harvest_fee: 1 * feePrecision,
          withdrawal_fee: 5 * feePrecision,
        },
      },
    ];

    await tFarm.setFees(fees);
    await tFarm.updateStorage({ farms: [0] });

    strictEqual(
      +tFarm.storage.storage.farms[0].fees.harvest_fee,
      fees[0].fees.harvest_fee
    );
    strictEqual(
      +tFarm.storage.storage.farms[0].fees.withdrawal_fee,
      fees[0].fees.withdrawal_fee
    );
  });

  it("should set/update fees for group of farms", async () => {
    const fees: SetFeeParams[] = [
      {
        fid: 0,
        fees: {
          harvest_fee: 16 * feePrecision,
          withdrawal_fee: 21 * feePrecision,
        },
      },
      {
        fid: 1,
        fees: {
          harvest_fee: 5 * feePrecision,
          withdrawal_fee: 25 * feePrecision,
        },
      },
      {
        fid: 2,
        fees: {
          harvest_fee: 3 * feePrecision,
          withdrawal_fee: 3 * feePrecision,
        },
      },
    ];

    await tFarm.setFees(fees);
    await tFarm.updateStorage({ farms: [0, 1, 2] });

    for (let i = 0; i < fees.length; ++i) {
      strictEqual(
        +tFarm.storage.storage.farms[i].fees.harvest_fee,
        fees[i].fees.harvest_fee
      );
      strictEqual(
        +tFarm.storage.storage.farms[i].fees.withdrawal_fee,
        fees[i].fees.withdrawal_fee
      );
    }
  });

  it("should fail if not admin is trying to pause farm", async () => {
    const pauseFarmParams: PauseFarmParam[] = [{ fid: 0, pause: true }];

    await utils.setProvider(alice.sk);
    await rejects(tFarm.pauseFarms(pauseFarmParams), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should fail if one farm from list of farms not found", async () => {
    const pauseFarmParams: PauseFarmParam[] = [{ fid: 666, pause: true }];

    await utils.setProvider(bob.sk);
    await rejects(tFarm.pauseFarms(pauseFarmParams), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should pause one farm", async () => {
    const pauseFarmParams: PauseFarmParam[] = [{ fid: 0, pause: true }];

    await tFarm.pauseFarms(pauseFarmParams);
    await tFarm.updateStorage({ farms: [0] });

    strictEqual(
      tFarm.storage.storage.farms[0].paused,
      pauseFarmParams[0].pause
    );
  });

  it("should unpause one farm", async () => {
    const pauseFarmParams: PauseFarmParam[] = [{ fid: 0, pause: false }];

    await tFarm.pauseFarms(pauseFarmParams);
    await tFarm.updateStorage({ farms: [0] });

    strictEqual(
      tFarm.storage.storage.farms[0].paused,
      pauseFarmParams[0].pause
    );
  });

  it("should pause group of farms", async () => {
    const pauseFarmParams: PauseFarmParam[] = [
      { fid: 0, pause: true },
      { fid: 1, pause: true },
      { fid: 2, pause: true },
    ];

    await tFarm.pauseFarms(pauseFarmParams);
    await tFarm.updateStorage({ farms: [0, 1, 2] });

    for (let pauseFarmParam of pauseFarmParams) {
      strictEqual(
        tFarm.storage.storage.farms[pauseFarmParam.fid].paused,
        pauseFarmParam.pause
      );
    }
  });

  it("should unpause group of farms", async () => {
    const pauseFarmParams: PauseFarmParam[] = [
      { fid: 0, pause: false },
      { fid: 2, pause: false },
    ];

    await tFarm.pauseFarms(pauseFarmParams);
    await tFarm.updateStorage({ farms: [0, 2] });

    for (let pauseFarmParam of pauseFarmParams) {
      strictEqual(
        tFarm.storage.storage.farms[pauseFarmParam.fid].paused,
        pauseFarmParam.pause
      );
    }
  });

  it("should pause/unpause group of farms", async () => {
    const pauseFarmParams: PauseFarmParam[] = [
      { fid: 1, pause: false },
      { fid: 2, pause: true },
    ];

    await tFarm.pauseFarms(pauseFarmParams);
    await tFarm.updateStorage({ farms: [1, 2] });

    for (let pauseFarmParam of pauseFarmParams) {
      strictEqual(
        tFarm.storage.storage.farms[pauseFarmParam.fid].paused,
        pauseFarmParam.pause
      );
    }
  });

  it("should fail if farm not found", async () => {
    const depositParams: DepositParams = {
      fid: 666,
      amt: 0,
      referrer: zeroAddress,
      rewards_receiver: zeroAddress,
      candidate: zeroAddress,
    };

    await rejects(tFarm.deposit(depositParams), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should fail if farm is paused", async () => {
    const depositParams: DepositParams = {
      fid: 2,
      amt: 0,
      referrer: zeroAddress,
      rewards_receiver: zeroAddress,
      candidate: zeroAddress,
    };

    await rejects(tFarm.deposit(depositParams), (err: Error) => {
      ok(err.message === "TFarm/farm-is-paused");

      return true;
    });
  });

  it("should fail if user is trying to refer himself", async () => {
    const pauseFarmParams: PauseFarmParam[] = [{ fid: 2, pause: false }];
    const depositParams: DepositParams = {
      fid: 0,
      amt: 0,
      referrer: alice.pkh,
      rewards_receiver: zeroAddress,
      candidate: zeroAddress,
    };

    await tFarm.pauseFarms(pauseFarmParams);
    await utils.setProvider(alice.sk);
    await rejects(tFarm.deposit(depositParams), (err: Error) => {
      ok(err.message === "TFarm/can-not-refer-yourself");

      return true;
    });
  });

  it("should set/update referrer", async () => {
    const depositParams: DepositParams = {
      fid: 2,
      amt: 100,
      referrer: bob.pkh,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await tFarm.updateStorage({ referrers: [alice.pkh] });

    strictEqual(tFarm.storage.storage.referrers[alice.pkh], undefined);

    await fa12.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({ referrers: [alice.pkh] });

    strictEqual(
      tFarm.storage.storage.referrers[alice.pkh],
      depositParams.referrer
    );
  });

  it("should not set/update referrer if referrer param not passed", async () => {
    const depositParams: DepositParams = {
      fid: 2,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await tFarm.updateStorage({ referrers: [alice.pkh] });

    strictEqual(tFarm.storage.storage.referrers[alice.pkh], bob.pkh);

    await fa12.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({ referrers: [alice.pkh] });

    strictEqual(tFarm.storage.storage.referrers[alice.pkh], bob.pkh);
  });

  it("should deposit single FA1.2 token", async () => {
    const depositParams: DepositParams = {
      fid: 2,
      amt: 100,
      referrer: bob.pkh,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await utils.setProvider(alice.sk);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialTokenAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await fa12.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked + depositParams.amt);
    strictEqual(
      +finalFarmAliceRecord.staked,
      +initialFarmAliceRecord.staked + depositParams.amt
    );
    strictEqual(
      +finalTokenAliceRecord.balance,
      +initialTokenAliceRecord.balance - depositParams.amt
    );
    strictEqual(
      +finalTokenFarmRecord.balance,
      +initialTokenFarmRecord.balance + depositParams.amt
    );
  });

  it("should deposit LP FA1.2 token", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 600; // 10 minutes

    newFarmParams.fees.harvest_fee = 30 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 6 * feePrecision;
    newFarmParams.stake_params.staked_token = { fA12: fa12LP.contract.address };
    newFarmParams.stake_params.is_lp_staked_token = true;
    newFarmParams.stake_params.token = { fA12: fa12.contract.address };
    newFarmParams.stake_params.qs_pool = fa12LP.contract.address;
    newFarmParams.reward_per_second = 4 * precision;
    newFarmParams.timelock = 0;
    newFarmParams.reward_token = { fA12: fa12.contract.address };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );

    const rewardsAmount: number =
      (lifetime * newFarmParams.reward_per_second) / precision;

    await utils.setProvider(bob.sk);
    await fa12.approve(tFarm.contract.address, rewardsAmount);
    await tFarm.addNewFarm(newFarmParams);
    await utils.setProvider(alice.sk);

    const depositParams: DepositParams = {
      fid: 3,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await fa12LP.updateStorage({
      ledger: [alice.pkh],
    });

    const initialTokenAliceRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[alice.pkh];

    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12LP.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[alice.pkh];
    const finalTokenFarmRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, depositParams.amt);
    strictEqual(+finalFarmAliceRecord.staked, depositParams.amt);
    strictEqual(
      +finalTokenAliceRecord.balance,
      +initialTokenAliceRecord.balance - depositParams.amt
    );
    strictEqual(+finalTokenFarmRecord.balance, 0);
    strictEqual(+finalTokenFarmRecord.frozen_balance, depositParams.amt);
  });

  it("should deposit single FA2 token", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 600; // 10 minutes

    newFarmParams.fees.harvest_fee = 25 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 7 * feePrecision;
    newFarmParams.stake_params.staked_token = {
      fA2: { token: fa2.contract.address, id: 0 },
    };
    newFarmParams.stake_params.token = {
      fA2: { token: fa2.contract.address, id: 0 },
    };
    newFarmParams.stake_params.qs_pool = fa2LP.contract.address;
    newFarmParams.reward_per_second = 5 * precision;
    newFarmParams.timelock = 0;
    newFarmParams.reward_token = { fA12: fa12.contract.address };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );

    const rewardsAmount: number =
      (lifetime * newFarmParams.reward_per_second) / precision;

    await utils.setProvider(bob.sk);
    await fa12.approve(tFarm.contract.address, rewardsAmount);
    await tFarm.addNewFarm(newFarmParams);
    await utils.setProvider(alice.sk);

    const depositParams: DepositParams = {
      fid: 4,
      amt: 10,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await tFarm.updateStorage({
      farms: [depositParams.fid],
    });
    await fa2.updateStorage({
      account_info: [alice.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialTokenAliceRecord: UserFA2Info =
      fa2.storage.account_info[alice.pkh];
    const updateOperatorParam: UpdateOperatorParam = {
      add_operator: {
        owner: alice.pkh,
        operator: tFarm.contract.address,
        token_id: 0,
      },
    };

    await fa2.updateOperators([updateOperatorParam]);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa2.updateStorage({
      account_info: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA2Info =
      fa2.storage.account_info[alice.pkh];
    const finalTokenFarmRecord: UserFA2Info =
      fa2.storage.account_info[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked + depositParams.amt);
    strictEqual(+finalFarmAliceRecord.staked, depositParams.amt);
    strictEqual(
      +(await finalTokenAliceRecord.balances.get("0")),
      +(await initialTokenAliceRecord.balances.get("0")) - depositParams.amt
    );
    strictEqual(
      +(await finalTokenFarmRecord.balances.get("0")),
      depositParams.amt
    );
  });

  it("should deposit LP FA2 token", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 1200; // 20 minutes

    newFarmParams.fees.harvest_fee = 15 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 21 * feePrecision;
    newFarmParams.stake_params.staked_token = {
      fA2: { token: fa2LP.contract.address, id: 0 },
    };
    newFarmParams.stake_params.is_lp_staked_token = true;
    newFarmParams.stake_params.token = {
      fA2: { token: fa2.contract.address, id: 0 },
    };
    newFarmParams.stake_params.qs_pool = fa2LP.contract.address;
    newFarmParams.reward_per_second = 10 * precision;
    newFarmParams.timelock = 0;
    newFarmParams.reward_token = {
      fA2: { token: qsGov.contract.address, id: 0 },
    };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );

    await utils.setProvider(bob.sk);
    await tFarm.addNewFarm(newFarmParams);
    await utils.setProvider(alice.sk);

    const depositParams: DepositParams = {
      fid: 5,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await fa2LP.updateStorage({
      ledger: [alice.pkh],
    });

    const initialTokenAliceRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[alice.pkh];
    const updateOperatorParam: UpdateOperatorParam = {
      add_operator: {
        owner: alice.pkh,
        operator: tFarm.contract.address,
        token_id: 0,
      },
    };

    await fa2LP.updateOperators([updateOperatorParam]);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa2LP.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[alice.pkh];
    const finalTokenFarmRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, depositParams.amt);
    strictEqual(+finalFarmAliceRecord.staked, depositParams.amt);
    strictEqual(
      +finalTokenAliceRecord.balance,
      +initialTokenAliceRecord.balance - depositParams.amt
    );
    strictEqual(+finalTokenFarmRecord.balance, 0);
    strictEqual(+finalTokenFarmRecord.frozen_balance, depositParams.amt);
  });

  it("should claim user's rewards (in farms without timelock)", async () => {
    const depositParams: DepositParams = {
      fid: 2,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await fa12.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked > initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokBobRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should claim user's rewards if timelock is finished (in farms with timelock)", async () => {
    const depositParams: DepositParams = {
      fid: 0,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked > initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should not claim user's rewards if timelock is not finished (in farms with timelock)", async () => {
    const depositParams: DepositParams = {
      fid: 0,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked > initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarned
      )
    );
    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance)
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance)
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
      )
    );
  });

  it("should transfer FA1.2 reward tokens as reward to rewards receiver", async () => {
    const depositParams: DepositParams = {
      fid: 3,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as reward to rewards receiver", async () => {
    const depositParams: DepositParams = {
      fid: 5,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokBobRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA1.2 reward tokens as harvest fee to referrer (in case when user have referrer)", async () => {
    const depositParams: DepositParams = {
      fid: 3,
      amt: 100,
      referrer: bob.pkh,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as harvest fee to referrer (in case when user have referrer)", async () => {
    const depositParams: DepositParams = {
      fid: 5,
      amt: 100,
      referrer: zeroAddress,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokBobRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA1.2 reward tokens as harvest fee to zero address (in case when user does not have referrer)", async () => {
    const depositParams: DepositParams = {
      fid: 3,
      amt: 100,
      referrer: zeroAddress,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokZeroRecord: UserFA12Info =
      fa12.storage.ledger[zeroAddress];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokZeroRecord.balance).isEqualTo(
        res.referralCommission
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as harvest fee to zero address (in case when user does not have referrer)", async () => {
    const depositParams: DepositParams = {
      fid: 5,
      amt: 100,
      referrer: bob.pkh,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokZeroRecord.balances.get("0"))).isEqualTo(
        res.referralCommission
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should calculate and transfer reward tokens as harvest fee with decimals (like 4.2%)", async () => {
    const depositParams: DepositParams = {
      fid: 2,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await fa12.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, alice.pkh]],
      farms: [depositParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokBobRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should vote for the baker if LP token is deposited", async () => {
    const transferAmt: number = 3000;
    const depositParams: DepositParams = {
      fid: 3,
      amt: transferAmt / 2,
      referrer: alice.pkh,
      rewards_receiver: dev.pkh,
      candidate: bob.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, dev.pkh]],
      candidates: [[depositParams.fid, dev.pkh]],
      votes: [[depositParams.fid, bob.pkh]],
      farms: [depositParams.fid],
    });
    await fa12LP.transfer(alice.pkh, dev.pkh, transferAmt);
    await utils.setProvider(dev.sk);
    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, dev.pkh]],
      candidates: [[depositParams.fid, dev.pkh]],
      votes: [[depositParams.fid, bob.pkh]],
      farms: [depositParams.fid],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmDevRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${dev.pkh}`];
    const finalFarmDevCandidate: string =
      tFarm.storage.storage.candidates[`${depositParams.fid},${dev.pkh}`];
    const finalFarmBobVotes: number =
      tFarm.storage.storage.votes[`${depositParams.fid},${bob.pkh}`];

    strictEqual(finalFarm.current_delegated, depositParams.candidate);
    strictEqual(finalFarm.current_candidate, depositParams.candidate);
    strictEqual(+finalFarmDevRecord.used_votes, depositParams.amt);
    strictEqual(finalFarmDevCandidate, depositParams.candidate);
    strictEqual(+finalFarmBobVotes, +finalFarm.staked);
  });

  it("should change current delegated for the next candidate if votes were redistributed", async () => {
    const depositParams: DepositParams = {
      fid: 3,
      amt: 1500,
      referrer: bob.pkh,
      rewards_receiver: dev.pkh,
      candidate: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[depositParams.fid, dev.pkh]],
      candidates: [[depositParams.fid, dev.pkh]],
      votes: [[depositParams.fid, bob.pkh]],
      farms: [depositParams.fid],
    });

    const initialFarmDevRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${dev.pkh}`];
    const initialFarmBobVotes: number =
      tFarm.storage.storage.votes[`${depositParams.fid},${bob.pkh}`];

    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await tFarm.updateStorage({
      users_info: [[depositParams.fid, dev.pkh]],
      candidates: [[depositParams.fid, dev.pkh]],
      votes: [
        [depositParams.fid, alice.pkh],
        [depositParams.fid, bob.pkh],
      ],
      farms: [depositParams.fid],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[depositParams.fid];
    const finalFarmDevRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${depositParams.fid},${dev.pkh}`];
    const finalFarmDevCandidate: string =
      tFarm.storage.storage.candidates[`${depositParams.fid},${dev.pkh}`];
    const finalFarmAliceVotes: number =
      tFarm.storage.storage.votes[`${depositParams.fid},${alice.pkh}`];
    const finalFarmBobVotes: number =
      tFarm.storage.storage.votes[`${depositParams.fid},${bob.pkh}`];

    strictEqual(finalFarm.current_delegated, depositParams.candidate);
    strictEqual(finalFarm.current_candidate, bob.pkh);
    strictEqual(+finalFarmDevRecord.used_votes, depositParams.amt * 2);
    strictEqual(finalFarmDevCandidate, depositParams.candidate);
    strictEqual(+finalFarmAliceVotes, depositParams.amt * 2);
    strictEqual(
      +finalFarmBobVotes,
      +initialFarmBobVotes - initialFarmDevRecord.used_votes
    );
  });

  it("should fail if farm not found", async () => {
    const harvestParams: HarvestParams = {
      fid: 666,
      rewards_receiver: dev.pkh,
    };

    await rejects(tFarm.harvest(harvestParams), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should claim user's rewards", async () => {
    const harvestParams: HarvestParams = {
      fid: 0,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await utils.setProvider(alice.sk);
    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked === initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.referralCommission)
          .minus(res.actualUserEarned)
      )
    );
  });

  it("should fail if timelock is not finished (in farms with timelock)", async () => {
    const depositParams: DepositParams = {
      fid: 0,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };
    const harvestParams: HarvestParams = {
      fid: 0,
      rewards_receiver: alice.pkh,
    };

    await fa12.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await rejects(tFarm.harvest(harvestParams), (err: Error) => {
      ok(err.message === "TFarm/timelock-is-not-finished");

      return true;
    });
  });

  it("should transfer FA1.2 reward tokens as reward to rewards receiver", async () => {
    const harvestParams: HarvestParams = {
      fid: 3,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as reward to rewards receiver", async () => {
    const harvestParams: HarvestParams = {
      fid: 5,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokBobRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA1.2 reward tokens as harvest fee to referrer (in case when user have referrer)", async () => {
    const harvestParams: HarvestParams = {
      fid: 3,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as harvest fee to referrer (in case when user have referrer)", async () => {
    const harvestParams: HarvestParams = {
      fid: 5,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokBobRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA1.2 reward tokens as harvest fee to zero address (in case when user does not have referrer)", async () => {
    const depositParams: DepositParams = {
      fid: 3,
      amt: 100,
      referrer: zeroAddress,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };
    const harvestParams: HarvestParams = {
      fid: 3,
      rewards_receiver: alice.pkh,
    };

    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await utils.bakeBlocks(1);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokZeroRecord: UserFA12Info =
      fa12.storage.ledger[zeroAddress];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokZeroRecord: UserFA12Info =
      fa12.storage.ledger[zeroAddress];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokZeroRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokZeroRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as harvest fee to zero address (in case when user does not have referrer)", async () => {
    const harvestParams: HarvestParams = {
      fid: 5,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokZeroRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokZeroRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should calculate and transfer reward tokens as harvest fee with decimals (like 4.2%)", async () => {
    const harvestParams: HarvestParams = {
      fid: 2,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.harvest(harvestParams);
    await tFarm.updateStorage({
      users_info: [[harvestParams.fid, alice.pkh]],
      farms: [harvestParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[harvestParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${harvestParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokZeroRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokZeroRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should fail if farm not found", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 666,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await rejects(tFarm.withdraw(withdrawParams), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should fail if staked by user amount is less than amount to withdraw", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 0,
      amt: 100_000_000,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await rejects(tFarm.withdraw(withdrawParams), (err: Error) => {
      ok(err.message === "TFarm/balance-too-low");

      return true;
    });
  });

  it("should withdraw single FA1.2 token", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 2,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialTokenAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams.amt);
    strictEqual(
      +finalFarmAliceRecord.staked,
      +initialFarmAliceRecord.staked - withdrawParams.amt
    );
    strictEqual(
      +finalTokenAliceRecord.balance,
      +initialTokenAliceRecord.balance + withdrawParams.amt
    );
    strictEqual(
      +finalTokenFarmRecord.balance,
      +initialTokenFarmRecord.balance - withdrawParams.amt
    );

    ok(finalFarmAliceRecord.last_staked === initialFarmAliceRecord.last_staked);
  });

  it("should withdraw LP FA1.2 token", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 3,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12LP.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialTokenAliceRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[alice.pkh];
    const initialTokenFarmRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12LP.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[alice.pkh];
    const finalTokenFarmRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams.amt);
    strictEqual(
      +finalFarmAliceRecord.staked,
      +initialFarmAliceRecord.staked - withdrawParams.amt
    );
    strictEqual(
      +finalTokenAliceRecord.balance,
      +initialTokenAliceRecord.balance + withdrawParams.amt
    );
    strictEqual(+finalTokenFarmRecord.balance, 0);
    strictEqual(
      +finalTokenFarmRecord.frozen_balance,
      +initialTokenFarmRecord.frozen_balance - withdrawParams.amt
    );
  });

  it("should withdraw single FA2 token", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 4,
      amt: 5,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa2.updateStorage({
      account_info: [tFarm.contract.address, alice.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialTokenAliceRecord: UserFA2Info =
      fa2.storage.account_info[alice.pkh];
    const initialTokenFarmRecord: UserFA2Info =
      fa2.storage.account_info[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa2.updateStorage({
      account_info: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA2Info =
      fa2.storage.account_info[alice.pkh];
    const finalTokenFarmRecord: UserFA2Info =
      fa2.storage.account_info[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams.amt);
    strictEqual(
      +finalFarmAliceRecord.staked,
      +initialFarmAliceRecord.staked - withdrawParams.amt
    );
    strictEqual(
      +(await finalTokenAliceRecord.balances.get("0")),
      +(await initialTokenAliceRecord.balances.get("0")) + withdrawParams.amt
    );
    strictEqual(
      +(await finalTokenFarmRecord.balances.get("0")),
      +(await initialTokenFarmRecord.balances.get("0")) - withdrawParams.amt
    );
  });

  it("should withdraw LP FA2 token", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 5,
      amt: 50,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa2LP.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialTokenAliceRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[alice.pkh];
    const initialTokenFarmRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa2LP.updateStorage({
      ledger: [tFarm.contract.address, alice.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalTokenAliceRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[alice.pkh];
    const finalTokenFarmRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams.amt);
    strictEqual(
      +finalFarmAliceRecord.staked,
      +initialFarmAliceRecord.staked - withdrawParams.amt
    );
    strictEqual(
      +finalTokenAliceRecord.balance,
      +initialTokenAliceRecord.balance + withdrawParams.amt
    );
    strictEqual(+finalTokenFarmRecord.balance, 0);
    strictEqual(
      +finalTokenFarmRecord.frozen_balance,
      +initialTokenFarmRecord.frozen_balance - withdrawParams.amt
    );
  });

  it("should withdraw tokens to the specified receiver", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 5,
      amt: 20,
      receiver: dev.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa2LP.updateStorage({
      ledger: [tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialTokenFarmRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa2LP.updateStorage({
      ledger: [tFarm.contract.address, dev.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalTokenDevRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[dev.pkh];
    const finalTokenFarmRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams.amt);
    strictEqual(
      +finalFarmAliceRecord.staked,
      +initialFarmAliceRecord.staked - withdrawParams.amt
    );
    strictEqual(+finalTokenDevRecord.balance, withdrawParams.amt);
    strictEqual(+finalTokenFarmRecord.balance, 0);
    strictEqual(
      +finalTokenFarmRecord.frozen_balance,
      +initialTokenFarmRecord.frozen_balance - withdrawParams.amt
    );
  });

  it("should claim user's rewards (in farms without timelock)", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 2,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked === initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokZeroRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokZeroRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should claim user's rewards if timelock is finished (in farms with timelock)", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 0,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, zeroAddress],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialQsGovAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialQsGovZeroRecord: UserFA12Info =
      fa12.storage.ledger[zeroAddress];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, zeroAddress],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalQsGovAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalQsGovZeroRecord: UserFA12Info = fa12.storage.ledger[zeroAddress];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked === initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(+finalQsGovAliceRecord.balance).isEqualTo(
        new BigNumber(+initialQsGovAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalQsGovZeroRecord.balance).isEqualTo(
        new BigNumber(+initialQsGovZeroRecord.balance).plus(
          res.referralCommission
        )
      )
    );
  });

  it("should transfer FA1.2 user's rewards to admin if timelock is not finished (in farms with timelock)", async () => {
    const depositParams: DepositParams = {
      fid: 0,
      amt: 1000,
      referrer: bob.pkh,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };
    const withdrawParams: WithdrawParams = {
      fid: 0,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.deposit(depositParams);
    await utils.bakeBlocks(1);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialQsGovAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialQsGovBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalQsGovAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalQsGovBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked === initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(+finalQsGovAliceRecord.balance).isEqualTo(
        new BigNumber(+initialQsGovAliceRecord.balance)
      )
    );
    ok(
      new BigNumber(+finalQsGovBobRecord.balance).isEqualTo(
        new BigNumber(+initialQsGovBobRecord.balance).plus(res.actualUserBurned)
      )
    );
  });

  it("should transfer FA2 user's rewards to admin if timelock is not finished (in farms with timelock)", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 300; // 5 minutes

    newFarmParams.fees.harvest_fee = 14 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 60 * feePrecision;
    newFarmParams.stake_params.staked_token = { fA12: fa12.contract.address };
    newFarmParams.stake_params.token = { fA12: fa12.contract.address };
    newFarmParams.stake_params.qs_pool = fa12LP.contract.address;
    newFarmParams.timelock = 5;
    newFarmParams.reward_token = {
      fA2: { token: qsGov.contract.address, id: 0 },
    };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );
    newFarmParams.reward_per_second = 3 * precision;

    await utils.setProvider(bob.sk);
    await tFarm.addNewFarm(newFarmParams);
    await utils.setProvider(alice.sk);

    const depositParams: DepositParams = {
      fid: 6,
      amt: 1000,
      referrer: bob.pkh,
      rewards_receiver: alice.pkh,
      candidate: zeroAddress,
    };
    const withdrawParams: WithdrawParams = {
      fid: 6,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await fa12.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await utils.bakeBlocks(1);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialQsGovAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialQsGovBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalQsGovAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalQsGovBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(finalFarmAliceRecord.last_staked === initialFarmAliceRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmAliceRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmAliceRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(+(await finalQsGovAliceRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialQsGovAliceRecord.balances.get("0")))
      )
    );
    ok(
      new BigNumber(+(await finalQsGovBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialQsGovBobRecord.balances.get("0"))).plus(
          res.actualUserBurned
        )
      )
    );
  });

  it("should stake withdrawal fee from farm's name", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 6,
      amt: 200,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [
        [withdrawParams.fid, alice.pkh],
        [withdrawParams.fid, tFarm.contract.address],
      ],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams.fid},${tFarm.contract.address}`
      ];
    const initialTokenAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [
        [withdrawParams.fid, alice.pkh],
        [withdrawParams.fid, tFarm.contract.address],
      ],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams.fid},${tFarm.contract.address}`
      ];
    const finalTokenAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: WithdrawData = TFarmUtils.getWithdrawData(
      initialFarm,
      withdrawParams.amt,
      feePrecision
    );

    ok(
      new BigNumber(+finalFarm.staked).isEqualTo(
        new BigNumber(+initialFarm.staked).minus(res.actualUserWithdraw)
      )
    );
    ok(
      new BigNumber(finalTokenAliceRecord.balance).isEqualTo(
        new BigNumber(+initialTokenAliceRecord.balance).plus(
          res.actualUserWithdraw
        )
      )
    );
    ok(
      new BigNumber(+finalTokenFarmRecord.balance).isEqualTo(
        new BigNumber(+initialTokenFarmRecord.balance).minus(
          res.actualUserWithdraw
        )
      )
    );
    ok(finalFarmFarmRecord.last_staked > initialFarmFarmRecord.last_staked);
    ok(
      new BigNumber(+finalFarmFarmRecord.staked).isEqualTo(
        new BigNumber(+initialFarmFarmRecord.staked).plus(
          res.wirthdrawCommission
        )
      )
    );

    strictEqual(
      +finalFarmAliceRecord.staked,
      +initialFarmAliceRecord.staked - withdrawParams.amt
    );
  });

  it("should transfer FA1.2 reward tokens as reward to rewards receiver", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 3,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as reward to rewards receiver", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 4,
      amt: 5,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA1.2 reward tokens as harvest fee to referrer (in case when user have referrer)", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 3,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokBobRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokBobRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as harvest fee to referrer (in case when user have referrer)", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 6,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, bob.pkh, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokBobRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA1.2 reward tokens as harvest fee to zero address (in case when user does not have referrer)", async () => {
    const depositParams: DepositParams = {
      fid: 3,
      amt: 100,
      referrer: zeroAddress,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };
    const withdrawParams: WithdrawParams = {
      fid: 3,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await utils.bakeBlocks(1);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA12Info =
      fa12.storage.ledger[alice.pkh];
    const initialRewTokZeroRecord: UserFA12Info =
      fa12.storage.ledger[zeroAddress];
    const initialRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA12Info = fa12.storage.ledger[alice.pkh];
    const finalRewTokZeroRecord: UserFA12Info =
      fa12.storage.ledger[zeroAddress];
    const finalRewTokFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(+finalRewTokAliceRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokAliceRecord.balance).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokZeroRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokZeroRecord.balance).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+finalRewTokFarmRecord.balance).isEqualTo(
        new BigNumber(+initialRewTokFarmRecord.balance)
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should transfer FA2 reward tokens as harvest fee to zero address (in case when user does not have referrer)", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 6,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokZeroRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokZeroRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should calculate and transfer reward tokens as harvest fee with decimals (like 4.2%)", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 2,
      amt: 100,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const initialRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const initialRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const initialRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, alice.pkh]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [alice.pkh, zeroAddress, tFarm.contract.address],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmAliceRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${alice.pkh}`];
    const finalRewTokAliceRecord: UserFA2Info =
      qsGov.storage.account_info[alice.pkh];
    const finalRewTokZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];
    const finalRewTokFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmAliceRecord,
      finalFarmAliceRecord,
      precision,
      feePrecision
    );

    ok(
      new BigNumber(
        +(await finalRewTokAliceRecord.balances.get("0"))
      ).isEqualTo(
        new BigNumber(+(await initialRewTokAliceRecord.balances.get("0"))).plus(
          res.actualUserEarned
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokZeroRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokZeroRecord.balances.get("0"))).plus(
          res.referralCommission
        )
      )
    );
    ok(
      new BigNumber(+(await finalRewTokFarmRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialRewTokFarmRecord.balances.get("0")))
          .minus(res.actualUserEarned)
          .minus(res.referralCommission)
      )
    );
  });

  it("should change current delegated for the next candidate if votes were redistributed", async () => {
    const withdrawParams: WithdrawParams = {
      fid: 3,
      amt: 3000,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, dev.pkh]],
      votes: [
        [withdrawParams.fid, alice.pkh],
        [withdrawParams.fid, bob.pkh],
      ],
      farms: [withdrawParams.fid],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmDevRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${dev.pkh}`];
    const initialFarmAliceVotes: number =
      tFarm.storage.storage.votes[`${withdrawParams.fid},${alice.pkh}`];
    const initialFarmBobVotes: number =
      tFarm.storage.storage.votes[`${withdrawParams.fid},${bob.pkh}`];

    await utils.setProvider(dev.sk);
    await tFarm.withdraw(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, dev.pkh]],
      candidates: [[withdrawParams.fid, dev.pkh]],
      votes: [
        [withdrawParams.fid, alice.pkh],
        [withdrawParams.fid, bob.pkh],
      ],
      farms: [withdrawParams.fid],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmDevRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${withdrawParams.fid},${dev.pkh}`];
    const finalFarmDevCandidate: string =
      tFarm.storage.storage.candidates[`${withdrawParams.fid},${dev.pkh}`];
    const finalFarmAliceVotes: number =
      tFarm.storage.storage.votes[`${withdrawParams.fid},${alice.pkh}`];
    const finalFarmBobVotes: number =
      tFarm.storage.storage.votes[`${withdrawParams.fid},${bob.pkh}`];

    strictEqual(finalFarm.current_delegated, initialFarm.current_candidate);
    strictEqual(finalFarm.current_candidate, initialFarm.current_delegated);
    strictEqual(+finalFarmDevRecord.used_votes, 0);
    strictEqual(finalFarmDevCandidate, finalFarm.current_candidate);
    strictEqual(
      +finalFarmAliceVotes,
      +initialFarmAliceVotes - initialFarmDevRecord.used_votes
    );
    strictEqual(+finalFarmBobVotes, +initialFarmBobVotes);
  });

  it("should fail if not admin is trying to burn XTZ rewards", async () => {
    await rejects(tFarm.burnXTZRewards(0), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should fail if farm not found", async () => {
    await utils.setProvider(bob.sk);
    await rejects(tFarm.burnXTZRewards(666), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should fail if not LP token is staked on the farm", async () => {
    await rejects(tFarm.burnXTZRewards(0), (err: Error) => {
      ok(err.message === "TFarm/not-LP-farm");

      return true;
    });
  });

  it("should withdraw bakers rewards in XTZ from the QS pool, swap for QS GOV tokens and burn them", async () => {
    await fa12LP.updateStorage({
      ledger: [alice.pkh],
    });
    await qsGov.updateStorage({
      account_info: [zeroAddress],
    });

    const depositParams: DepositParams = {
      fid: 3,
      amt: +fa12LP.storage.storage.ledger[alice.pkh].balance / 2,
      referrer: bob.pkh,
      rewards_receiver: alice.pkh,
      candidate: alice.pkh,
    };
    const initialQsGovZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];

    await utils.setProvider(alice.sk);
    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);
    await utils.setProvider(bob.sk);

    const operation = await utils.tezos.contract.transfer({
      to: tFarm.storage.storage.farms[depositParams.fid].stake_params.qs_pool,
      amount: 500,
      mutez: true,
    });

    await confirmOperation(utils.tezos, operation.hash);
    await utils.bakeBlocks(1);
    await tFarm.burnXTZRewards(depositParams.fid);
    await qsGov.updateStorage({
      account_info: [zeroAddress],
    });

    const finalQsGovZeroRecord: UserFA2Info =
      qsGov.storage.account_info[zeroAddress];

    ok(
      +(await finalQsGovZeroRecord.balances.get("0")) >
        +(await initialQsGovZeroRecord.balances.get("0"))
    );
  });

  it("should fail if not admin is trying to claim farm rewards", async () => {
    await utils.setProvider(alice.sk);
    await rejects(tFarm.claimFarmRewards(0), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should fail if farm not found", async () => {
    await utils.setProvider(bob.sk);
    await rejects(tFarm.claimFarmRewards(666), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should transfer FA1.2 reward tokens to the admin", async () => {
    const fid: number = 0;

    await tFarm.updateStorage({
      users_info: [[fid, tFarm.contract.address]],
      farms: [fid],
    });
    await fa12.updateStorage({
      ledger: [bob.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[fid];
    const initialFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${fid},${tFarm.contract.address}`];
    const initialQsGovBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];

    await tFarm.claimFarmRewards(fid);
    await tFarm.updateStorage({
      users_info: [[fid, tFarm.contract.address]],
      farms: [fid],
    });
    await fa12.updateStorage({
      ledger: [bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[fid];
    const finalFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${fid},${tFarm.contract.address}`];
    const finalQsGovBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmFarmRecord,
      finalFarmFarmRecord,
      precision,
      feePrecision
    );

    ok(finalFarmFarmRecord.last_staked === initialFarmFarmRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmFarmRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmFarmRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(+finalQsGovBobRecord.balance).isEqualTo(
        new BigNumber(+initialQsGovBobRecord.balance).plus(
          res.expectedUserEarned
            .div(precision)
            .integerValue(BigNumber.ROUND_DOWN)
        )
      )
    );
  });

  it("should transfer FA2 reward tokens to the admin", async () => {
    const fid: number = 6;

    await tFarm.updateStorage({
      users_info: [[fid, tFarm.contract.address]],
      farms: [fid],
    });
    await qsGov.updateStorage({
      account_info: [bob.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[fid];
    const initialFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${fid},${tFarm.contract.address}`];
    const initialQsGovBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];

    await tFarm.claimFarmRewards(fid);
    await tFarm.updateStorage({
      users_info: [[fid, tFarm.contract.address]],
      farms: [fid],
    });
    await qsGov.updateStorage({
      account_info: [bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[fid];
    const finalFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[`${fid},${tFarm.contract.address}`];
    const finalQsGovBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const res: FarmData = TFarmUtils.getFarmData(
      initialFarm,
      finalFarm,
      initialFarmFarmRecord,
      finalFarmFarmRecord,
      precision,
      feePrecision
    );

    ok(finalFarmFarmRecord.last_staked === initialFarmFarmRecord.last_staked);
    ok(finalFarm.upd > initialFarm.upd);
    ok(new BigNumber(finalFarm.rps).isEqualTo(res.expectedShareReward));
    ok(
      new BigNumber(finalFarmFarmRecord.prev_earned).isEqualTo(
        res.expectedUserPrevEarned
      )
    );
    ok(
      new BigNumber(finalFarmFarmRecord.earned).isEqualTo(
        res.expectedUserEarnedAfterHarvest
      )
    );
    ok(
      new BigNumber(+(await finalQsGovBobRecord.balances.get("0"))).isEqualTo(
        new BigNumber(+(await initialQsGovBobRecord.balances.get("0"))).plus(
          res.expectedUserEarned
            .div(precision)
            .integerValue(BigNumber.ROUND_DOWN)
        )
      )
    );
  });

  it("should fail if not admit is trying to withdraw farm depo", async () => {
    const withdrawParams: WithdrawFarmDepoParams = { fid: 0, amt: 0 };

    await utils.setProvider(alice.sk);
    await rejects(tFarm.withdrawFarmDepo(withdrawParams), (err: Error) => {
      ok(err.message === "Not-admin");

      return true;
    });
  });

  it("should fail if farm not found", async () => {
    const withdrawParams: WithdrawFarmDepoParams = { fid: 666, amt: 0 };

    await utils.setProvider(bob.sk);
    await rejects(tFarm.withdrawFarmDepo(withdrawParams), (err: Error) => {
      ok(err.message === "TFarm/farm-not-set");

      return true;
    });
  });

  it("should fail if staked by farm amount is less than amount to withdraw", async () => {
    const withdrawParams: WithdrawFarmDepoParams = {
      fid: 0,
      amt: 100_000_000,
    };

    await rejects(tFarm.withdrawFarmDepo(withdrawParams), (err: Error) => {
      ok(err.message === "TFarm/balance-too-low");

      return true;
    });
  });

  it("should withdraw single FA1.2 token", async () => {
    const withdrawParams: WithdrawFarmDepoParams = {
      fid: 6,
      amt: 3,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, tFarm.contract.address]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [tFarm.contract.address, bob.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams.fid},${tFarm.contract.address}`
      ];
    const initialTokenBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const initialTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    await tFarm.withdrawFarmDepo(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, tFarm.contract.address]],
      farms: [withdrawParams.fid],
    });
    await fa12.updateStorage({
      ledger: [tFarm.contract.address, bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams.fid},${tFarm.contract.address}`
      ];
    const finalTokenBobRecord: UserFA12Info = fa12.storage.ledger[bob.pkh];
    const finalTokenFarmRecord: UserFA12Info =
      fa12.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams.amt);
    strictEqual(
      +finalFarmFarmRecord.staked,
      +initialFarmFarmRecord.staked - withdrawParams.amt
    );
    strictEqual(
      +finalTokenBobRecord.balance,
      +initialTokenBobRecord.balance + withdrawParams.amt
    );
    strictEqual(
      +finalTokenFarmRecord.balance,
      +initialTokenFarmRecord.balance - withdrawParams.amt
    );
  });

  it("should withdraw LP FA1.2 token", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 120; // 2 minutes

    newFarmParams.fees.harvest_fee = 21 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 60 * feePrecision;
    newFarmParams.stake_params.staked_token = { fA12: fa12LP.contract.address };
    newFarmParams.stake_params.is_lp_staked_token = true;
    newFarmParams.stake_params.token = { fA12: fa12.contract.address };
    newFarmParams.stake_params.qs_pool = fa12LP.contract.address;
    newFarmParams.reward_per_second = 2 * precision;
    newFarmParams.timelock = 5;
    newFarmParams.reward_token = { fA12: fa12.contract.address };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );

    const rewardsAmount: number =
      (lifetime * newFarmParams.reward_per_second) / precision;

    await fa12.approve(tFarm.contract.address, rewardsAmount);
    await tFarm.addNewFarm(newFarmParams);

    const depositParams: DepositParams = {
      fid: 7,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await utils.setProvider(alice.sk);
    await fa12LP.approve(tFarm.contract.address, depositParams.amt);
    await tFarm.deposit(depositParams);

    const withdrawParams1: WithdrawParams = {
      fid: depositParams.fid,
      amt: depositParams.amt,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.withdraw(withdrawParams1);
    await utils.setProvider(bob.sk);

    const withdrawParams2: WithdrawFarmDepoParams = {
      fid: depositParams.fid,
      amt: 10,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams2.fid, tFarm.contract.address]],
      farms: [withdrawParams2.fid],
    });
    await fa12LP.updateStorage({
      ledger: [tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams2.fid];
    const initialFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams2.fid},${tFarm.contract.address}`
      ];
    const initialTokenFarmRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[tFarm.contract.address];

    await tFarm.withdrawFarmDepo(withdrawParams2);
    await tFarm.updateStorage({
      users_info: [[withdrawParams2.fid, tFarm.contract.address]],
      farms: [withdrawParams2.fid],
    });
    await fa12LP.updateStorage({
      ledger: [tFarm.contract.address, bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams2.fid];
    const finalFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams2.fid},${tFarm.contract.address}`
      ];
    const finalTokenBobRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[bob.pkh];
    const finalTokenFarmRecord: UserFA12Info =
      fa12LP.storage.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams2.amt);
    strictEqual(
      +finalFarmFarmRecord.staked,
      +initialFarmFarmRecord.staked - withdrawParams2.amt
    );
    strictEqual(+finalTokenBobRecord.balance, withdrawParams2.amt);
    strictEqual(+finalTokenFarmRecord.balance, 5100);
    strictEqual(
      +finalTokenFarmRecord.frozen_balance,
      +initialTokenFarmRecord.frozen_balance - withdrawParams2.amt
    );
  });

  it("should withdraw single FA2 token", async () => {
    const withdrawParams: WithdrawFarmDepoParams = {
      fid: 0,
      amt: 3,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, tFarm.contract.address]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [tFarm.contract.address, bob.pkh],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const initialFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams.fid},${tFarm.contract.address}`
      ];
    const initialTokenBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const initialTokenFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    await tFarm.withdrawFarmDepo(withdrawParams);
    await tFarm.updateStorage({
      users_info: [[withdrawParams.fid, tFarm.contract.address]],
      farms: [withdrawParams.fid],
    });
    await qsGov.updateStorage({
      account_info: [tFarm.contract.address, bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams.fid];
    const finalFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams.fid},${tFarm.contract.address}`
      ];
    const finalTokenBobRecord: UserFA2Info =
      qsGov.storage.account_info[bob.pkh];
    const finalTokenFarmRecord: UserFA2Info =
      qsGov.storage.account_info[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams.amt);
    strictEqual(
      +finalFarmFarmRecord.staked,
      +initialFarmFarmRecord.staked - withdrawParams.amt
    );
    strictEqual(
      +(await finalTokenBobRecord.balances.get("0")),
      +(await initialTokenBobRecord.balances.get("0")) + withdrawParams.amt
    );
    strictEqual(
      +(await finalTokenFarmRecord.balances.get("0")),
      +(await initialTokenFarmRecord.balances.get("0")) - withdrawParams.amt
    );
  });

  it("should withdraw LP FA2 token", async () => {
    let newFarmParams: NewFarmParams = await TFarmUtils.getMockNewFarmParams(
      utils
    );
    const lifetime: number = 120; // 2 minutes

    newFarmParams.fees.harvest_fee = 21 * feePrecision;
    newFarmParams.fees.withdrawal_fee = 60 * feePrecision;
    newFarmParams.stake_params.staked_token = {
      fA2: { token: fa2LP.contract.address, id: 0 },
    };
    newFarmParams.stake_params.is_lp_staked_token = true;
    newFarmParams.stake_params.token = {
      fA2: { token: fa2.contract.address, id: 0 },
    };
    newFarmParams.stake_params.qs_pool = fa12LP.contract.address;
    newFarmParams.reward_per_second = 2 * precision;
    newFarmParams.timelock = 5;
    newFarmParams.reward_token = { fA12: fa12.contract.address };
    newFarmParams.end_time = String(
      Date.parse((await utils.tezos.rpc.getBlockHeader()).timestamp) / 1000 +
        lifetime
    );

    const rewardsAmount: number =
      (lifetime * newFarmParams.reward_per_second) / precision;

    await fa12.approve(tFarm.contract.address, rewardsAmount);
    await tFarm.addNewFarm(newFarmParams);

    const depositParams: DepositParams = {
      fid: 8,
      amt: 100,
      referrer: undefined,
      rewards_receiver: alice.pkh,
      candidate: bob.pkh,
    };

    await utils.setProvider(alice.sk);
    await tFarm.deposit(depositParams);

    const withdrawParams1: WithdrawParams = {
      fid: depositParams.fid,
      amt: depositParams.amt,
      receiver: alice.pkh,
      rewards_receiver: alice.pkh,
    };

    await tFarm.withdraw(withdrawParams1);
    await utils.setProvider(bob.sk);

    const withdrawParams2: WithdrawFarmDepoParams = {
      fid: depositParams.fid,
      amt: 2,
    };

    await tFarm.updateStorage({
      users_info: [[withdrawParams2.fid, tFarm.contract.address]],
      farms: [withdrawParams2.fid],
    });
    await fa2LP.updateStorage({
      ledger: [tFarm.contract.address],
    });

    const initialFarm: Farm = tFarm.storage.storage.farms[withdrawParams2.fid];
    const initialFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams2.fid},${tFarm.contract.address}`
      ];
    const initialTokenFarmRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[tFarm.contract.address];

    await tFarm.withdrawFarmDepo(withdrawParams2);
    await tFarm.updateStorage({
      users_info: [[withdrawParams2.fid, tFarm.contract.address]],
      farms: [withdrawParams2.fid],
    });
    await fa2LP.updateStorage({
      ledger: [tFarm.contract.address, bob.pkh],
    });

    const finalFarm: Farm = tFarm.storage.storage.farms[withdrawParams2.fid];
    const finalFarmFarmRecord: UserInfoType =
      tFarm.storage.storage.users_info[
        `${withdrawParams2.fid},${tFarm.contract.address}`
      ];
    const finalTokenBobRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[bob.pkh];
    const finalTokenFarmRecord: UserFA2LPInfo =
      fa2LP.storage.storage.ledger[tFarm.contract.address];

    strictEqual(+finalFarm.staked, +initialFarm.staked - withdrawParams2.amt);
    strictEqual(
      +finalFarmFarmRecord.staked,
      +initialFarmFarmRecord.staked - withdrawParams2.amt
    );
    strictEqual(+finalTokenBobRecord.balance, withdrawParams2.amt);
    strictEqual(+finalTokenFarmRecord.balance, 58);
    // TODO fix revote entrypoint (farm used does not have candidate)
    strictEqual(
      +finalTokenFarmRecord.frozen_balance,
      +initialTokenFarmRecord.frozen_balance - withdrawParams2.amt
    );
  });
});
