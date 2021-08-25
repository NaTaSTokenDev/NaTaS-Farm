const { MichelsonMap } = require("@taquito/michelson-encoder");

const zeroAddress = "tz1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZNkiRg";

module.exports = {
  storage: {
    farms: MichelsonMap.fromLiteral({}),
    referrers: MichelsonMap.fromLiteral({}),
    temp: {
      min_qs_gov_output: "0",
      token: {
        token: zeroAddress,
        id: "0",
        is_fa2: false,
      },
      qs_pool: zeroAddress,
    },
    qsgov: {
      token: null,
      id: "0",
      is_fa2: true,
    },
    qsgov_pool: null,
    admin: null,
    pending_admin: null,
    burner: null,
    proxy_minter: null,
    baker_registry: null,
    farms_count: "0",
    qsgov_per_second: "0",
    total_alloc_point: "0",
  },
  q_farm_lambdas: MichelsonMap.fromLiteral({}),
};
