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

// src/collection/modules/collaborators.ts
var UpdateCollaborators = (state, action) => {
  const collaborators = state.collaborators;
  const input = action.input;
  const caller = action.caller;
  const creator = state.owner;
  ContractAssert(collaborators.includes(caller), "Caller not in collaborators.");
  ContractAssert(caller === creator, "Only the collection's owner can manage the collaborators.");
  for (const addr of input.collaborators) {
    ContractAssert(/[a-z0-9_-]{43}/i.test(addr), `Invalid address ${addr}`);
  }
  ContractAssert(input.collaborators.includes(creator), "Cannot remove creator from collaborators.");
  return {...state, collaborators: input.collaborators};
};

// src/collection/modules/details.ts
var UpdateDetails = (state, action) => {
  const collaborators = state.collaborators;
  const input = action.input;
  const caller = action.caller;
  ContractAssert(collaborators.includes(caller), "Caller not in collaborators.");
  return {
    ...state,
    name: input.name ?? state.name,
    description: input.description ?? state.description
  };
};

// src/collection/modules/invoke.ts
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

// src/collection/modules/items.ts
var UpdateItems = (state, action) => {
  const collaborators = state.collaborators;
  const input = action.input;
  const caller = action.caller;
  ContractAssert(collaborators.includes(caller), "Caller not in collaborators.");
  for (const itemID of input.items) {
    ContractAssert(/[a-z0-9_-]{43}/i.test(itemID), `Invalid token ID ${itemID}`);
  }
  return {...state, items: input.items};
};

// src/collection/modules/readOutbox.ts
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

// src/collection/index.ts
export async function handle(state, action) {
  switch (action.input.function) {
    case "updateDetails":
      return {state: UpdateDetails(state, action)};
    case "updateCollaborators":
      return {state: UpdateCollaborators(state, action)};
    case "updateItems":
      return {state: UpdateItems(state, action)};
    case "readOutbox":
      return {state: await ReadOutbox(state, action)};
    case "invoke":
      return {state: await Invoke(state, action)};
    default:
      throw new ContractError(`Invalid function: "${action.input.function}"`);
  }
}
