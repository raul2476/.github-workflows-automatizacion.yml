const MONDAY_API_URL = "https://api.monday.com/v2";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

async function mondayRequest(query, variables) {
  const token = requireEnv("MONDAY_API_TOKEN");

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  if (json.errors) {
    throw new Error(`Error de Monday API: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

async function crearLeadEnMonday(itemName, notas) {
  const boardId = requireEnv("MONDAY_BOARD_ID");

  const createItemQuery = `
    mutation ($boardId: ID!, $itemName: String!) {
      create_item(board_id: $boardId, item_name: $itemName) {
        id
      }
    }
  `;
  const itemData = await mondayRequest(createItemQuery, { boardId, itemName });
  const itemId = itemData.create_item.id;

  const createUpdateQuery = `
    mutation ($itemId: ID!, $body: String!) {
      create_update(item_id: $itemId, body: $body) {
        id
      }
    }
  `;
  await mondayRequest(createUpdateQuery, { itemId, body: notas });

  return { itemId };
}

module.exports = { crearLeadEnMonday };
