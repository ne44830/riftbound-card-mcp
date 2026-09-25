# Riftbound card image MCP service

This is a ready-to-deploy MCP server for the existing Riftbound TCG Judge plugin.
It adds `show_base_card(name, set?)`, which finds the ordinary printing in the
unofficial Riftcodex database and serves its image in an inline MCP Apps card.
The existing rules skill remains the source of judge behavior.

If the live Riftcodex API rejects a cloud-hosting IP with HTTP 403, the lookup
uses the included dated `base-cards.json` metadata snapshot. No card image
files are bundled. The tool response identifies when the snapshot was used.
Refresh that snapshot periodically when new cards are released.

## Run and test

```bash
npm ci
npm start
```

The local endpoint is `http://localhost:8787/mcp` by default. Set `PORT` to
change it. The server attempts `https://api.riftcodex.com` first; the ChatGPT
card-image component must load images from `https://cmsassets.rgpub.io`.

Use MCP Inspector with Streamable HTTP to test `show_base_card` for
`Pyke - Returned`. It should return `unl-145-219` and an inline image. Test
an unknown name, an alternate-art-only name, and an ambiguous fuzzy name.

## Connect to the Judge plugin

1. Deploy this Node service at a stable public HTTPS URL, ending in `/mcp`.
   A temporary tunnel is suitable for developer testing but not a persistent
   Judge plugin. The server has no user authentication because the card API is
   public and the tool is read-only.
2. In ChatGPT developer mode, connect and test that exact HTTPS `/mcp` URL.
3. Add root `mcp.json` to the **existing** Judge plugin:

   ```json
   {
     "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
     "mcpServers": {
       "riftbound-cards": {
         "type": "streamable-http",
         "url": "https://YOUR-HOST.example/mcp"
       }
     }
   }
   ```

4. Bump the existing root `plugin.json` version and add `mcp` to
   `extensions.com.openai.interface.capabilities`, retaining `skills`,
   every starter prompt, metadata field, and the existing rules skill.
   Update the matching legacy manifest version and capabilities if retained.
5. Add a sentence to the card-image section of the existing skill:
   “When a card image is requested, call `show_base_card` once for each named
   card; use its inline component. Use the returned card identity and image URL
   for the accompanying ruling. Riftcodex text is unofficial.”
6. Upload the update to the **same** plugin ID, then test a fresh chat with
   “Show Pyke - Returned’s base card image inline.”

The plugin’s skill text or Markdown syntax alone cannot force the client to
render remote images. The registered MCP component is what supplies inline UI.
The component is displayed above the assistant’s textual answer by ChatGPT.
