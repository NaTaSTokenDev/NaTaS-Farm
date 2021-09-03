import { FA2 } from "./helpers/FA2";
import { Utils, zeroAddress } from "./helpers/Utils";
import { Burner } from "./helpers/Burner";
import { QSFA2Factory } from "./helpers/QSFA2Factory";

import { rejects, ok, strictEqual } from "assert";

import { alice, bob } from "../scripts/sandbox/accounts";

import { burnerStorage } from "../storage/Burner";
import { fa2Storage } from "storage/test/FA2";
import { qsFA2FactoryStorage } from "storage/test/QSFA2Factory";

import {
  BalanceRequest,
  BalanceResponse,
  UpdateOperatorParam,
} from "./types/FA2";

describe.only("Burner tests", async () => {
  var qsGov: FA2;
  var utils: Utils;
  var burner: Burner;
  var qsFA2Factory: QSFA2Factory;

  before("setup", async () => {
    utils = new Utils();

    await utils.init(alice.sk);

    qsGov = await FA2.originate(utils.tezos, fa2Storage);
    qsFA2Factory = await QSFA2Factory.originate(
      utils.tezos,
      qsFA2FactoryStorage
    );

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

    const qsgov_lp = await qsFA2Factory.storage.token_to_exchange[
      `${qsGov.contract.address},${0}`
    ];

    burnerStorage.qsgov_lp.token = qsgov_lp;
    burnerStorage.qsgov_lp.id = 0;
    burnerStorage.qsgov_lp.is_fa2 = true;
    burnerStorage.qsgov.token = qsGov.contract.address;
    burnerStorage.qsgov.id = 0;
    burnerStorage.qsgov.is_fa2 = true;

    burner = await Burner.originate(utils.tezos, burnerStorage);
  });

  it("should swap all XTZ from contract for QS GOV tokens and burn them", async () => {
    await burner.burn();
  });

  it("should fail if not QS GOV token contract is trying to call callback", async () => {
    const balanceRequest: BalanceRequest = { owner: alice.pkh, token_id: 0 };
    const balanceResponse: BalanceResponse[] = [
      { request: balanceRequest, balance: 666 },
    ];

    await rejects(burner.burnCallback(balanceResponse), (err: Error) => {
      ok(err.message === "Burner/not-QS-GOV-token");

      return true;
    });
  });
});
