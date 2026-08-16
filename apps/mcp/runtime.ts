import server from './.mcp-use/build/index.js'

const { url } = await server.listen()
console.log(`Spliit Assistant MCP server is running at ${url}`)
