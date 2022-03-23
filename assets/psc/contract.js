// src/utils.ts
var isAddress = (addr) => {
  if (!addr)
    return false;
  if (typeof addr !== "string")
    return false;
  return !!/^[a-z0-9_-]{43}$/i.test(addr);
};
var RESTRICT_TO_INTEGER = true;

// src/modules/transfer.ts
function Transfer(state, action) {
  const input = action.input;
  const target = input.target;
  ContractAssert(!!target, "No target specified");
  ContractAssert(isAddress(target), `The given target is not a valid Arweave address: ${input.target}`);
  const caller = action.caller;
  ContractAssert(caller !== target, "User cannot transfer to themselves");
  const qty = input.qty;
  ContractAssert(Number.isInteger(qty) || !RESTRICT_TO_INTEGER, 'Invalid value for "qty". Must be an integer');
  ContractAssert(qty > 0, "Transfer qty is too low");
  const balances = state.balances;
  ContractAssert(caller in balances, "Caller doesn't own any DAO balance");
  ContractAssert(balances[caller] >= qty, `Caller balance not high enough to send ${qty} token(s)`);
  balances[caller] -= qty;
  if (target in balances) {
    balances[target] += qty;
  } else {
    balances[target] = qty;
  }
  return state;
}

// src/modules/transferLocked.ts
function TransferLocked(state, action) {
  const input = action.input;
  const caller = action.caller;
  const target = input.target;
  ContractAssert(!!target, "No target specified");
  ContractAssert(isAddress(target), `The given target is not a valid Arweave address: ${input.target}`);
  const qty = +input.qty;
  ContractAssert(Number.isInteger(qty) || !RESTRICT_TO_INTEGER, 'Invalid value for "qty". Must be an integer');
  ContractAssert(qty > 0, "Transfer qty is too low");
  const lockLength = +input.lockLength;
  const settings = new Map(state.settings);
  ContractAssert(Number.isInteger(lockLength), 'Invalid value for "lockLength". Must be an integer');
  ContractAssert(lockLength > settings.get("lockMinLength") && lockLength < settings.get("lockMaxLength"), `Input for "lockLength" is out of range, must be between ${settings.get("lockMinLength")} and ${settings.get("lockMaxLength")}`);
  const balances = state.balances;
  const balance = balances[caller];
  ContractAssert(!isNaN(balance) && balance >= qty, "Not enough balance");
  balances[caller] -= qty;
  const start = +SmartWeave.block.height;
  const end = start + lockLength;
  const vault = state.vault;
  if (target in vault) {
    vault[target].push({
      balance: qty,
      end,
      start
    });
  } else {
    vault[target] = [
      {
        balance: qty,
        end,
        start
      }
    ];
  }
  return state;
}

// src/modules/balance.ts
function Balance(state, action) {
  const caller = action.caller;
  const input = action.input;
  const target = input.target || caller;
  ContractAssert(/[a-z0-9_-]{43}/i.test(target), "Caller did not supply a valid target.");
  const balances = state.balances;
  const vault = state.vault;
  let balance = 0;
  if (target in balances) {
    balance = balances[target];
  }
  if (target in vault && vault[target].length) {
    try {
      balance += vault[target].map((a) => a.balance).reduce((a, b) => a + b, 0);
    } catch (e) {
    }
  }
  return { target, balance };
}

// src/modules/unlockedBalance.ts
function UnlockedBalance(state, action) {
  const caller = action.caller;
  const input = action.input;
  const target = input.target || caller;
  ContractAssert(/[a-z0-9_-]{43}/i.test(target), "Caller did not supply a valid target.");
  const balances = state.balances;
  let balance = 0;
  if (target in balances) {
    balance = balances[target];
  }
  return { target, balance };
}

// src/modules/lock.ts
function Lock(state, action) {
  const input = action.input;
  const caller = action.caller;
  const qty = +input.qty;
  ContractAssert(Number.isInteger(qty) || !RESTRICT_TO_INTEGER, 'Invalid value for "qty". Must be an integer');
  ContractAssert(qty > 0, "Lock qty is too low");
  const lockLength = +input.lockLength;
  const settings = new Map(state.settings);
  ContractAssert(Number.isInteger(lockLength), 'Invalid value for "lockLength". Must be an integer');
  ContractAssert(lockLength > settings.get("lockMinLength") && lockLength < settings.get("lockMaxLength"), `Input for "lockLength" is out of range, must be between ${settings.get("lockMinLength")} and ${settings.get("lockMaxLength")}`);
  const balances = state.balances;
  const balance = balances[caller];
  ContractAssert(!isNaN(balance) && balance >= qty, "Not enough balance");
  balances[caller] -= qty;
  const start = +SmartWeave.block.height;
  const end = start + lockLength;
  const vault = state.vault;
  if (caller in vault) {
    vault[caller].push({
      balance: qty,
      end,
      start
    });
  } else {
    vault[caller] = [
      {
        balance: qty,
        end,
        start
      }
    ];
  }
  return state;
}

// src/modules/readOutbox.ts
async function ReadOutbox(state, action) {
  const input = action.input;
  ContractAssert(!!input.contract, "Missing contract to invoke");
  const foreignState = await SmartWeave.contracts.readContractState(input.contract);
  ContractAssert(!!foreignState.foreignCalls, "Contract is missing support for foreign calls");
  const calls = foreignState.foreignCalls.filter((element) => element.contract === SmartWeave.contract.id && !state.invocations.includes(element.txID));
  let res = state;
  for (const entry of calls) {
    const invokedRes = await handle(res, {
      caller: input.contract,
      input: entry.input
    });
    if (!invokedRes.state)
      continue;
    res = invokedRes.state;
    res.invocations.push(entry.txID);
  }
  return res;
}

// src/modules/invoke.ts
async function Invoke(state, action) {
  const input = action.input;
  ContractAssert(!!input.invocation, "Missing function invocation");
  ContractAssert(!!input.foreignContract, "Missing foreign contract ID");
  state.foreignCalls.push({
    txID: SmartWeave.transaction.id,
    contract: input.foreignContract,
    input: input.invocation
  });
  return state;
}

// src/modules/increaseVault.ts
function IncreaseVault(state, action) {
  const input = action.input;
  const caller = action.caller;
  const lockLength = input.lockLength;
  const settings = new Map(state.settings);
  ContractAssert(Number.isInteger(lockLength), 'Invalid value for "lockLength". Must be an integer');
  ContractAssert(lockLength > settings.get("lockMinLength") && lockLength < settings.get("lockMaxLength"), `Input for "lockLength" is out of range, must be between ${settings.get("lockMinLength")} and ${settings.get("lockMaxLength")}`);
  const id = input.id;
  const vault = state.vault;
  ContractAssert(caller in vault, "Caller does not have a vault");
  ContractAssert(!!vault[caller][id], "Invalid vault ID");
  ContractAssert(+SmartWeave.block.height < vault[caller][id].end, "This vault has ended");
  vault[caller][id].end = +SmartWeave.block.height + lockLength;
  return state;
}

// src/modules/unlock.ts
function Unlock(state, action) {
  const caller = action.caller;
  const vault = state.vault;
  const balances = state.balances;
  if (!(caller in vault) || vault[caller].length === 0)
    return state;
  let i = vault[caller].length;
  while (i--) {
    const locked = vault[caller][i];
    if (+SmartWeave.block.height >= locked.end) {
      if (caller in balances && typeof balances[caller] === "number") {
        balances[caller] += locked.balance;
      } else {
        balances[caller] = locked.balance;
      }
      vault[caller].splice(i, 1);
    }
  }
  return state;
}

// src/modules/vaultBalance.ts
function VaultBalance(state, action) {
  const caller = action.caller;
  const input = action.input;
  const target = input.target || caller;
  ContractAssert(/[a-z0-9_-]{43}/i.test(target), "Caller did not supply a valid target.");
  const vault = state.vault;
  let balance = 0;
  if (target in vault) {
    const blockHeight = +SmartWeave.block.height;
    const filtered = vault[target].filter((a) => blockHeight < a.end);
    for (const vaultItem of filtered) {
      balance += vaultItem.balance;
    }
  }
  return { target, balance };
}

// src/modules/propose.ts
function Propose(state, action) {
  const input = action.input;
  const caller = action.caller;
  const note = input.note;
  const balances = state.balances;
  const settings = new Map(state.settings);
  ContractAssert(typeof note === "string", "Note format not recognized");
  const vault = state.vault;
  ContractAssert(caller in vault, "Caller needs to have locked balances.");
  ContractAssert(!!vault[caller] && !!vault[caller].filter((a) => a.balance > 0).length, "Caller doesn't have any locked balance");
  let totalWeight = 0;
  const vaultValues = Object.values(vault);
  for (const locked of vaultValues) {
    for (const lockedItem of locked) {
      totalWeight += lockedItem.balance * (lockedItem.end - lockedItem.start);
    }
  }
  const voteType = input.type;
  const votes = state.votes;
  let vote = {
    status: "active",
    type: voteType,
    note,
    yays: 0,
    nays: 0,
    voted: [],
    start: +SmartWeave.block.height,
    totalWeight
  };
  if (voteType === "mint" || voteType === "mintLocked") {
    const recipient = input.recipient;
    ContractAssert(isAddress(input.recipient), "Recipient address is invalid");
    const qty = +input.qty;
    ContractAssert(Number.isInteger(qty) || !RESTRICT_TO_INTEGER, "Qty is not a valid address");
    ContractAssert(qty > 0, "Qty is less than 0");
    let totalSupply = 0;
    const vaultValues2 = Object.values(vault);
    for (const vaultItem of vaultValues2) {
      for (const locked of vaultItem) {
        totalSupply += locked.balance;
      }
    }
    const balancesValues = Object.values(balances);
    for (const addrBalance of balancesValues) {
      totalSupply += addrBalance;
    }
    ContractAssert(totalSupply + qty < Number.MAX_SAFE_INTEGER, "Qty is too large");
    let lockLength = {};
    if (input.lockLength) {
      ContractAssert(Number.isInteger(input.lockLength), 'Invalid value for "lockLength". Must be an integer');
      ContractAssert(input.lockLength > settings.get("lockMinLength") && input.lockLength < settings.get("lockMaxLength"), `Input for "lockLength" is out of range, must be between ${settings.get("lockMinLength")} and ${settings.get("lockMaxLength")}`);
      lockLength = { lockLength: input.lockLength };
    }
    Object.assign(vote, {
      recipient,
      qty
    }, lockLength);
    votes.push(vote);
  } else if (voteType === "burnVault") {
    const target = input.target;
    ContractAssert(isAddress(target), "Target address is not a valid address");
    Object.assign(vote, {
      target
    });
    votes.push(vote);
  } else if (voteType === "set") {
    ContractAssert(typeof input.key === "string", "Data type of key not supported");
    if (input.key === "quorum" || input.key === "support" || input.key === "lockMinLength" || input.key === "lockMaxLength") {
      input.value = +input.value;
    }
    ContractAssert(input.key !== "quorum" || !isNaN(input.value) && input.value >= 0.01 && input.value <= 0.99, "Quorum must be between 0.01 and 0.99");
    ContractAssert(input.key !== "support" || !isNaN(input.value) && input.value >= 0.01 && input.value <= 0.99, "Quorum must be between 0.01 and 0.99");
    ContractAssert(input.key !== "lockMinLength" || Number.isInteger(input.value) && input.value >= 1 && input.value < settings.get("lockMaxLength"), "lockMinLength cannot be less than 1 and cannot be equal or greater than lockMaxLength");
    ContractAssert(input.key !== "lockMaxLength" || Number.isInteger(input.value) && input.value > settings.get("lockMinLength"), "lockMaxLength cannot be less than or equal to lockMinLength");
    if (input.key === "role") {
      const recipient = input.recipient;
      ContractAssert(isAddress(recipient), "Invalid recipient address");
      Object.assign(vote, {
        key: input.key,
        value: input.value,
        recipient
      });
    } else {
      Object.assign(vote, {
        key: input.key,
        value: input.value
      });
    }
    votes.push(vote);
  } else if (voteType === "indicative") {
    votes.push(vote);
  } else {
    throw new ContractError("Invalid vote type");
  }
  return state;
}

// src/modules/vote.ts
function Vote(state, action) {
  const input = action.input;
  const caller = action.caller;
  const id = input.id;
  const cast = input.cast;
  ContractAssert(Number.isInteger(id) || !RESTRICT_TO_INTEGER, 'Invalid value for "id". Must be an integer');
  const votes = state.votes;
  const vote = votes[id];
  const vault = state.vault;
  let voterBalance = 0;
  if (caller in vault) {
    for (let i = 0, j = vault[caller].length; i < j; i++) {
      const locked = vault[caller][i];
      if (locked.start < vote.start && locked.end >= vote.start) {
        voterBalance += locked.balance * (locked.end - locked.start);
      }
    }
  }
  ContractAssert(voterBalance > 0, "Caller does not have locked balances for this vote");
  ContractAssert(!vote.voted.includes(caller), "Caller has already voted");
  const settings = new Map(state.settings);
  ContractAssert(+SmartWeave.block.height < vote.start + settings.get("voteLength"), "Vote has already concluded");
  if (cast === "yay") {
    vote.yays += voterBalance;
  } else if (cast === "nay") {
    vote.nays += voterBalance;
  } else {
    throw new ContractError("Vote cast type unrecognised");
  }
  vote.voted.push(caller);
  return state;
}

// src/modules/finalize.ts
function Finalize(state, action) {
  const input = action.input;
  const id = input.id;
  const votes = state.votes;
  const vote = votes[id];
  const qty = vote.qty;
  ContractAssert(!!vote, "This vote doesn't exist");
  const settings = new Map(state.settings);
  ContractAssert(+SmartWeave.block.height >= vote.start + settings.get("voteLength"), "Vote has not yet concluded");
  ContractAssert(vote.status === "active", "Vote is not active");
  if (vote.totalWeight * settings.get("quorum") > vote.yays + vote.nays) {
    vote.status = "quorumFailed";
    return state;
  }
  const vault = state.vault;
  const balances = state.balances;
  if (vote.yays !== 0 && (vote.nays === 0 || vote.yays / vote.nays > settings.get("support"))) {
    vote.status = "passed";
    if (vote.type === "mint" || vote.type === "mintLocked") {
      let totalSupply = 0;
      const vaultValues = Object.values(vault);
      for (const locked of vaultValues) {
        for (const lockedItem of locked) {
          totalSupply += lockedItem.balance;
        }
      }
      const balancesValues = Object.values(balances);
      for (const balance of balancesValues) {
        totalSupply += balance;
      }
      ContractAssert(totalSupply + qty <= Number.MAX_SAFE_INTEGER, "Quantity is too large");
    }
    if (vote.type === "mint") {
      if (vote.recipient in balances) {
        balances[vote.recipient] += qty;
      } else {
        balances[vote.recipient] = qty;
      }
    } else if (vote.type === "mintLocked") {
      const start = +SmartWeave.block.height;
      const end = start + vote.lockLength;
      const locked = {
        balance: qty,
        start,
        end
      };
      if (vote.recipient in vault) {
        vault[vote.recipient].push(locked);
      } else {
        vault[vote.recipient] = [locked];
      }
    } else if (vote.type === "burnVault") {
      if (vote.target in vault) {
        delete vault[vote.target];
      } else {
        vote.status = "failed";
      }
    } else if (vote.type === "set") {
      if (vote.key === "role") {
        state.roles[vote.recipient] = vote.value;
      } else {
        settings.set(vote.key, vote.value);
        state.settings = Array.from(settings);
      }
    }
  } else {
    vote.status = "failed";
  }
  return state;
}

// src/modules/role.ts
function Role(state, action) {
  const input = action.input;
  const caller = action.caller;
  const target = input.target || caller;
  ContractAssert(isAddress(target), "Invalid target address");
  const role = target in state.roles ? state.roles[target] : "";
  ContractAssert(!!role.trim().length, "Target doesn't have a role specified");
  return { target, role };
}

// src/index.ts
export async function handle(state, action) {
  switch (action.input.function) {
    case "transfer":
      return { state: Transfer(state, action) };
    case "transferLocked":
      return { state: TransferLocked(state, action) };
    case "balance":
      return { result: Balance(state, action) };
    case "unlockedBalance":
      return { result: UnlockedBalance(state, action) };
    case "lock":
      return { state: Lock(state, action) };
    case "increaseVault":
      return { state: IncreaseVault(state, action) };
    case "unlock":
      return { state: Unlock(state, action) };
    case "vaultBalance":
      return { result: VaultBalance(state, action) };
    case "propose":
      return { state: Propose(state, action) };
    case "vote":
      return { state: Vote(state, action) };
    case "finalize":
      return { state: Finalize(state, action) };
    case "role":
      return { result: Role(state, action) };
    case "readOutbox":
      return { state: await ReadOutbox(state, action) };
    case "invoke":
      return { state: await Invoke(state, action) };
    default:
      throw new ContractError(`Invalid function: "${action.input.function}"`);
  }
}
