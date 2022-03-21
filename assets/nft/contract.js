/*
 * 
 * MIT License
 * 
 * Copyright (c) 2021- The Verto Protocol
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 * 
 * 
 */

// src/nft/modules/transfer.ts
var Transfer = (state, action) => {
  const balances = state.balances;
  const caller = action.caller;
  const input = action.input;
  const target = input.target;
  const qty = input.qty;
  ContractAssert(/[a-z0-9_-]{43}/i.test(target), "Caller did not supply a valid target.");
  ContractAssert(Number.isInteger(qty), `Invalid value for "qty". Must be an integer.`);
  ContractAssert(qty > 0 && caller !== target, "Invalid token transfer.");
  if (!(caller in balances)) {
    throw new ContractError("Caller doesn't own any tokens.");
  }
  if (balances[caller] < qty) {
    throw new ContractError(`Caller balance not high enough to send ${qty} token(s)!`);
  }
  balances[caller] -= qty;
  if (target in balances) {
    balances[target] += qty;
  } else {
    balances[target] = qty;
  }
  return {...state, balances};
};

// src/nft/modules/balance.ts
var Balance = (state, action) => {
  const balances = state.balances;
  const caller = action.caller;
  const input = action.input;
  const target = input.target || caller;
  ContractAssert(/[a-z0-9_-]{43}/i.test(target), "Caller did not supply a valid target.");
  let balance = 0;
  if (target in balances) {
    balance = balances[target];
  }
  return {target, balance};
};

// src/nft/modules/mint.ts
var Mint = (state, action) => {
  const owner = state.owner;
  const allowMinting = state.allowMinting;
  const balances = state.balances;
  const caller = action.caller;
  const input = action.input;
  const target = input.target;
  ContractAssert(allowMinting, "Minting is not allowed for this token.");
  ContractAssert(caller === owner, "Caller is not the contract owner.");
  ContractAssert(/[a-z0-9_-]{43}/i.test(target), "Caller did not supply a valid target.");
  if (target in balances) {
    throw new ContractError("User already owns tokens.");
  }
  balances[target] = 1;
  return {...state, balances};
};

// src/nft/modules/readOutbox.ts
var ReadOutbox = async (state, action) => {
  const input = action.input;
  ContractAssert(!!input.contract, "Missing contract to invoke");
  const foreignState = await SmartWeave.contracts.readContractState(input.contract);
  ContractAssert(!!foreignState.foreignCalls, "Contract is missing support for foreign calls");
  const calls = foreignState.foreignCalls.filter((element) => element.contract === SmartWeave.contract.id && !state.invocations.includes(element.txID));
  let res = state;
  for (const entry of calls) {
    res = (await handle(res, {caller: input.contract, input: entry.input})).state;
    res.invocations.push(entry.txID);
  }
  return res;
};

// src/nft/modules/invoke.ts
var Invoke = async (state, action) => {
  const input = action.input;
  ContractAssert(!!input.invocation, "Missing function invocation");
  ContractAssert(!!input.foreignContract, "Missing foreign contract ID");
  state.foreignCalls.push({
    txID: SmartWeave.transaction.id,
    contract: input.foreignContract,
    input: input.invocation
  });
  return state;
};

// src/nft/index.ts
export async function handle(state, action) {
  switch (action.input.function) {
    case "transfer":
      return {state: Transfer(state, action)};
    case "balance":
      return {result: Balance(state, action)};
    case "mint":
      return {state: Mint(state, action)};
    case "readOutbox":
      return {state: await ReadOutbox(state, action)};
    case "invoke":
      return {state: await Invoke(state, action)};
    default:
      throw new ContractError(`Invalid function: "${action.input.function}"`);
  }
}
