#include "../partial/i_farmland.ligo"
#include "../partial/farmland_methods.ligo"
#include "../partial/farmland_lambdas.ligo"

function main(
  const action          : full_action_type;
  const s               : full_storage_type)
                        : full_return_type is
  case action of
    Use(params)         -> call_farmland(params, s)
  | Setup_func(params)  -> setup_func(params, s)
  end