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

// src/community/modules/claim.ts
var Claim = (state, action) => {
  let people = state.people;
  const caller = action.caller;
  const input = action.input;
  const username = input.username;
  const name = input.name;
  const addresses = input.addresses || [];
  const image = input.image;
  const bio = input.bio;
  const links = input.links;
  if (!addresses.includes(caller))
    addresses.push(caller);
  ContractAssert(!!username, "Caller did not supply a valid username.");
  ContractAssert(!!name, "Caller did not supply a valid name.");
  const person = people.find((user) => user.username === username);
  if (person) {
    ContractAssert(person.addresses.includes(caller), "Caller is not in the addresses of the supplied user.");
    for (const addr of addresses)
      ContractAssert(!people.find((user) => user.addresses.includes(addr) && user.username !== person.username), `Address ${addr} is already added to a user.`);
    people = [
      ...people.filter((user) => user.username !== username),
      {
        ...person,
        name,
        addresses,
        image,
        bio,
        links
      }
    ];
  } else {
    for (const addr of addresses)
      ContractAssert(!people.find((user) => user.addresses.includes(addr)), `Address ${addr} is already added to a user.`);
    people.push({
      username,
      name,
      addresses,
      image,
      bio,
      links
    });
  }
  return {...state, people};
};

// src/community/modules/list.ts
var List = async (state, action) => {
  const people = state.people;
  const tokens = state.tokens;
  const caller = action.caller;
  const input = action.input;
  const id = input.id;
  const type = input.type;
  ContractAssert(/[a-z0-9_-]{43}/i.test(id), "Caller did not supply a valid token ID.");
  ContractAssert(type === "art" || type === "community" || type === "collection" || type === "custom", "Caller did not supply a valid token type.");
  try {
    const {state: contractState, initTx} = await getInitialState(id);
    ContractAssert(!!contractState, "Contract state is null.");
    if (type === "art" || type === "community") {
      ContractAssert(!!contractState.balances, "Contract does not have a balances object.");
      ContractAssert(contractState.name && contractState.ticker, "Contract does not have a name or a ticker.");
    }
    const isNFT = Object.values(contractState.balances).reduce((a, b) => a + b) === 1;
    const minter = initTx.owner;
    if (!isNFT) {
      ContractAssert(caller === minter, "Caller is not the minter of the token.");
    } else {
      const currentOwner = Object.keys(contractState.balances).find((addr) => contractState.balances[addr] > 0);
      ContractAssert(caller === minter || caller === currentOwner, "Caller is not the minter or the current owner of the token.");
    }
  } catch (e) {
    throw new ContractError("Contract does not exist.");
  }
  const identity = people.find((user) => user.addresses.find((address) => address === caller));
  ContractAssert(!!identity, "Caller does not have an identity.");
  const token = tokens.find((item) => item.id === id);
  ContractAssert(!token, "Token has already been listed.");
  tokens.push({
    id,
    type,
    lister: identity.username
  });
  return {...state, tokens};
};
async function getInitialState(contractID) {
  const contractTX = await SmartWeave.unsafeClient.transactions.get(contractID);
  if (getTagValue("Init-State", contractTX.tags))
    return {
      state: JSON.parse(getTagValue("Init-State", contractTX.tags)),
      initTx: contractTX
    };
  if (getTagValue("Init-State-TX", contractTX.tags))
    return {
      state: JSON.parse(await SmartWeave.unsafeClient.transactions.getData(getTagValue("Init-State-TX", contractTX.tags), {decode: true, string: true})),
      initTx: contractTX
    };
  return {
    state: JSON.parse(await SmartWeave.unsafeClient.transactions.getData(contractID, {
      decode: true,
      string: true
    })),
    initTx: contractTX
  };
}
var getTagValue = (name, tags) => tags.find((tag) => tag.name === name)?.value;

// src/community/modules/unlist.ts
var Unlist = (state, action) => {
  const people = state.people;
  const tokens = state.tokens;
  const caller = action.caller;
  const input = action.input;
  const id = input.id;
  const index = tokens.findIndex((token) => token.id === id);
  ContractAssert(index > -1, "Token has not been listed.");
  const identity = people.find((user) => user.addresses.find((address) => address === caller));
  ContractAssert(!!identity, "Caller does not have an identity.");
  ContractAssert(tokens[index].lister === identity.username, "Caller is not the owner of the token.");
  tokens.splice(index, 1);
  return {...state, tokens};
};

// src/community/index.ts
export async function handle(state, action) {
  switch (action.input.function) {
    case "claim":
      return {state: Claim(state, action)};
    case "list":
      return {state: await List(state, action)};
    case "unlist":
      return {state: Unlist(state, action)};
  }
}
