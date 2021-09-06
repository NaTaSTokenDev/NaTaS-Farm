import {
  TezosToolkit,
  OriginationOperation,
  WalletOperationBatch,
  WalletOperation,
  Contract,
  OpKind,
} from "@taquito/taquito";

import fs from "fs";

import { getLigo } from "scripts/helpers";

import { confirmOperation } from "../../scripts/confirmation";

import { QSFA12FactoryStorage } from "../types/QSFA12Factory";

import qs_fa12_factory_dex_lambdas from "../contracts/qs_fa12_factory_dex_lambdas.json";
import qs_fa12_factory_token_lambdas from "../contracts/qs_fa12_factory_token_lambdas.json";

export class QSFA12Factory {
  contract: Contract;
  storage: QSFA12FactoryStorage;
  tezos: TezosToolkit;

  constructor(contract: Contract, tezos: TezosToolkit) {
    this.contract = contract;
    this.tezos = tezos;
  }

  static async init(
    qsFA12FactoryAddress: string,
    tezos: TezosToolkit
  ): Promise<QSFA12Factory> {
    return new QSFA12Factory(
      await tezos.contract.at(qsFA12FactoryAddress),
      tezos
    );
  }

  static async originate(
    tezos: TezosToolkit,
    storage: QSFA12FactoryStorage
  ): Promise<QSFA12Factory> {
    const artifacts: any = JSON.parse(
      fs.readFileSync(`test/contracts/qs_fa12_factory.json`).toString()
    );
    const operation: OriginationOperation = await tezos.contract
      .originate({
        code: artifacts.michelson,
        storage: storage,
      })
      .catch((e) => {
        console.error(e);

        return null;
      });

    await confirmOperation(tezos, operation.hash);

    return new QSFA12Factory(
      await tezos.contract.at(operation.contractAddress),
      tezos
    );
  }

  async updateStorage(maps = {}): Promise<void> {
    const storage: QSFA12FactoryStorage = await this.contract.storage();

    this.storage = storage;

    for (const key in maps) {
      this.storage[key] = await maps[key].reduce(
        async (prev: any, current: any) => {
          try {
            return {
              ...(await prev),
              [current]: await storage[key].get(current),
            };
          } catch (ex) {
            return {
              ...(await prev),
              [current]: 0,
            };
          }
        },
        Promise.resolve({})
      );
    }
  }

  async setDexAndTokenLambdas(): Promise<void> {
    const ligo: string = getLigo(true);
    let params: any[] = [];

    for (const qs_fa12_factory_dex_lambda of qs_fa12_factory_dex_lambdas) {
      params.push({
        kind: OpKind.TRANSACTION,
        to: this.contract.address,
        amount: 0,
        parameter: {
          entrypoint: "setDexFunction",
          value: qs_fa12_factory_dex_lambda,
        },
      });
    }

    for (const qs_fa12_factory_token_lambda of qs_fa12_factory_token_lambdas) {
      params.push({
        kind: OpKind.TRANSACTION,
        to: this.contract.address,
        amount: 0,
        parameter: {
          entrypoint: "setTokenFunction",
          value: qs_fa12_factory_token_lambda,
        },
      });
    }

    const batch: WalletOperationBatch = this.tezos.wallet.batch(params);
    const operation: WalletOperation = await batch.send();

    await confirmOperation(this.tezos, operation.opHash);
  }
}