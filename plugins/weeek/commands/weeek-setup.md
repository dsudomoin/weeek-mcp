---
description: Store a Weeek API token on this machine for the Weeek MCP server
---

The user wants to set the Weeek MCP server up without leaving a token in a
configuration file.

The server needs one thing: a Weeek API token. A wizard asks for it, so all you
have to do is walk the user through running it.

**Do not ask the user for their token, and do not run the wizard yourself.** It
reads the token from the terminal without echoing it, which only works when the
user runs it, and it refuses outright when its input is a pipe. A token you
receive in this conversation is a token written into the transcript, which is
the one outcome the keychain exists to prevent. Tell them to run this in their
own terminal:

```
weeek-mcp init
```

If the server is not on their PATH — which is the case when their client
launches it through `npx` rather than from a global install — the same wizard
runs with:

```
npx -y @dsudomoin/weeek-mcp init
```

Explain what will happen, so nothing is a surprise:

1. It asks for the token, and nothing is shown as they type.
2. It checks the token against Weeek before storing anything. If Weeek rejects
   it, nothing is written anywhere.
3. It says who the token belongs to, so they can tell a wrong account from a
   wrong token.
4. It stores the token and **names the place** — the macOS Keychain, the Windows
   Credential Manager, the Secret Service, or a file readable only by them when
   the machine has no usable keychain. Ask them to read that line back: it is
   the difference between a token that survives a reboot and one that does not.
5. It says to restart the client. That part is not optional: the token is read
   once, when the server starts.

Tokens are created in Weeek under **Settings → API**.

Once they say it finished, and once the client has been restarted, verify it by
calling `weeek_context`. It should return their name, the workspace and its
projects. If it fails:

- **"WEEEK_API_TOKEN is not set and no token is stored"** means the wizard did
  not complete, or it ran against a different installation than the one the MCP
  client launches. Ask them to read out what it printed.
- **A 401 from Weeek** means the token was revoked after it was stored. Run the
  wizard again.
- **The server is not listed at all** means the MCP client has not been
  restarted since the server was added.

If the user would rather not store anything, the server also reads
`WEEEK_API_TOKEN` from the environment, and that takes priority over anything
stored on the machine. That is the right path for containers, for CI, and for
Codex, which replaces the environment of every server it launches.
