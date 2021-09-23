const BakerRegistry = require("../build/baker_registry.json");
const Burner = require("../build/burner.json");

const { execSync } = require("child_process");

const { TezosToolkit } = require("@taquito/taquito");
const { InMemorySigner } = require("@taquito/signer");

const { migrate, getLigo } = require("../scripts/helpers");
const { confirmOperation } = require("../scripts/confirmation");

const { alice, dev } = require("../scripts/sandbox/accounts");

const { tFarmStorage } = require("../storage/TFarm");
const tFarmFunctions = require("../storage/json/TFarmFunctions.json");

const env = require("../env");

module.exports = async (tezos) => {
  const secretKey = env.network === "development" ? alice.sk : dev.sk;
  const deployer = env.network === "development" ? alice.pkh : dev.pkh;

  tezos = new TezosToolkit(tezos.rpc.url);

  tezos.setProvider({
    config: {
      confirmationPollingTimeoutSecond: env.confirmationPollingTimeoutSecond,
    },
    signer: await InMemorySigner.fromSecretKey(secretKey),
  });

  tFarmStorage.storage.qsgov.token = "KT1NfYbYTCRZsNPZ97VdLqSrwPdVupiqniFu";
  tFarmStorage.storage.qsgov.id = 0;
  tFarmStorage.storage.qsgov_lp = "KT1NfYbYTCRZsNPZ97VdLqSrwPdVupiqniFu";
  tFarmStorage.storage.admin = deployer;
  tFarmStorage.storage.burner = Burner["networks"][env.network]["burner"];
  tFarmStorage.storage.baker_registry =
    BakerRegistry["networks"][env.network]["baker_registry"];

  const tFarmAddress = await migrate(tezos, "t_farm", tFarmStorage);

  console.log(`TFarm: ${tFarmAddress}`);

  const ligo = getLigo(true);

  for (tFarmFunction of tFarmFunctions) {
    const stdout = execSync(
      `${ligo} compile-parameter --michelson-format=json $PWD/contracts/main/t_farm.ligo main 'Setup_func(record index=${tFarmFunction.index}n; func=${tFarmFunction.name}; end)'`,
      { maxBuffer: 1024 * 500 }
    );
    const operation = await tezos.contract.transfer({
      to: tFarmAddress,
      amount: 0,
      parameter: {
        entrypoint: "setup_func",
        value: JSON.parse(stdout.toString()).args[0],
      },
    });

    await confirmOperation(tezos, operation.hash);

    console.log(
      tFarmFunction.index +
        1 +
        ". " +
        tFarmFunction.name +
        " successfully installed."
    );
  }
};
