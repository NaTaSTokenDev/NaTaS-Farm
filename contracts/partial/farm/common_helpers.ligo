function get_farm(
  const fid             : fid_type;
  const s               : storage_type)
                        : farm_type is
  case s.farms[fid] of
    None       -> (failwith("QSystem/farm-not-set") : farm_type)
  | Some(farm) -> farm
  end

function get_token_metadata(
  const fid             : fid_type;
  const s               : storage_type)
                        : tok_meta_type is
  case s.token_metadata[fid] of
    None           -> (failwith("QSystem/farm-not-set") : tok_meta_type)
  | Some(metadata) -> metadata
  end

function get_user_info(
  const fid             : fid_type;
  const user            : address;
  const s               : storage_type)
                        : user_info_type is
    case s.users_info[(fid, user)] of
      Some(info) -> info
    | None       -> record [
      last_staked = (0 : timestamp);
      staked      = 0n;
      earned      = 0n;
      prev_earned = 0n;
      used_votes  = 0n;
      allowances  = (set [] : set(address));
    ]
    end

function get_banned_baker_info(
  const baker           : key_hash;
  const s               : storage_type)
                        : banned_baker_type is
    case s.banned_bakers[baker] of
      Some(info) -> info
    | None       -> record [
      period = 0n;
      start  = (0 : timestamp);
    ]
    end

function update_farm_rewards(
  var _farm             : farm_type;
  var s                 : storage_type)
                        : storage_type * farm_type is
  block {
    if Tezos.now >= _farm.start_time
    then {
      if _farm.staked =/= 0n
      then {
        const time_diff : nat = abs(Tezos.now - _farm.upd);
        const reward : nat = time_diff * _farm.reward_per_second;

        _farm.reward_per_share :=
          _farm.reward_per_share + reward / _farm.staked;
      }
      else skip;

      _farm.upd := Tezos.now;

      s.farms[_farm.fid] := _farm;
    }
    else skip;
  } with (s, _farm)