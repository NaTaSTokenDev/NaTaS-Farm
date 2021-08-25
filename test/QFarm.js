const { Utils } = require("./helpers/Utils.ts");
const { QFarm } = require("./helpers/QFarm.ts");

const { rejects, ok, strictEqual } = require("assert");

const { alice, bob } = require("../scripts/sandbox/accounts");

const qFarmStorage = require("../storage/QFarm");

const zeroAddress = "tz1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZNkiRg";

describe("QFarm tests", async () => {
  var utils;
  var qFarm;

  before("setup", async () => {
    utils = new Utils();

    await utils.init();

    qFarmStorage.storage.qsgov.token = zeroAddress;
    qFarmStorage.storage.qsgov_pool = zeroAddress;
    qFarmStorage.storage.admin = alice.pkh;
    qFarmStorage.storage.pending_admin = zeroAddress;
    qFarmStorage.storage.burner = zeroAddress;
    qFarmStorage.storage.proxy_minter = zeroAddress;
    qFarmStorage.storage.baker_registry = zeroAddress;

    qFarm = await QFarm.originate(utils.tezos, qFarmStorage);

    await qFarm.setLambdas();
  });

  it("should fail if not admin is trying to setup new pending admin", async () => {
    await utils.setProvider(bob.sk);
    await rejects(qFarm.setAdmin(bob.pkh), (err) => {
      ok(err.message == "Not-admin", "Error message mismatch");

      return true;
    });
  });

  it("should setup new pending admin", async () => {
    await utils.setProvider(alice.sk);
    await qFarm.setAdmin(bob.pkh);
    await qFarm.updateStorage();

    strictEqual(qFarm.storage.storage.admin, alice.pkh);
    strictEqual(qFarm.storage.storage.pending_admin, bob.pkh);
  });
});
