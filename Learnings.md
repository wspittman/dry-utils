# Learnings

- The CosmosDB mock query processor must parse Boolean operators only at the
  current parenthesis depth. Splitting SQL text directly on `AND` or `OR`
  breaks nested `Where` groups and function calls.
