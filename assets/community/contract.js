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
  ContractAssert(username, "Caller did not supply a valid username.");
  ContractAssert(name, "Caller did not supply a valid name.");
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
var List = (state, action) => {
  const people = state.people;
  const tokens = state.tokens;
  const caller = action.caller;
  const input = action.input;
  const id = input.id;
  const type = input.type;
  ContractAssert(/[a-z0-9_-]{43}/i.test(id), "Caller did not supply a valid token ID.");
  ContractAssert(type === "art" || type === "community" || type === "collection" || type === "custom", "Caller did not supply a valid token type.");
  const identity = people.find((user) => user.addresses.find((address) => address === caller));
  ContractAssert(identity, "Caller does not have an identity.");
  const token = tokens.find((item) => item.id === id);
  ContractAssert(!token, "Token has already been listed.");
  tokens.push({
    id,
    type,
    lister: identity.username
  });
  return {...state, tokens};
};

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
  ContractAssert(identity, "Caller does not have an identity.");
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
      return {state: List(state, action)};
    case "unlist":
      return {state: Unlist(state, action)};
  }
}
