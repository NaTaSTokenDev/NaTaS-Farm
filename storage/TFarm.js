const { MichelsonMap } = require("@taquito/michelson-encoder");

const zero_address = "tz1ZZZZZZZZZZZZZZZZZZZZZZZZZZZZNkiRg";

module.exports = {
  storage: {
    farms: MichelsonMap.fromLiteral({}),
    referrers: MichelsonMap.fromLiteral({}),
    temp: {
      min_qs_gov_output: "0",
      token: {
        token: zero_address,
        id: "0",
        is_fa2: false,
      },
      qs_pool: zero_address,
    },
    qsgov: {
      token: null,
      id: "0",
    },
    qsgov_pool: null,
    admin: null,
    pending_admin: null,
    burner: null,
    proxy_minter: null,
    baker_registry: null,
    farms_count: "0",
  },
  t_farm_lambdas: MichelsonMap.fromLiteral({}),
};