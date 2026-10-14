# OSCARplus MCP

Find and explore McMaster Engineering Co-op postings with your AI assistant. OSCARplus MCP keeps a private local copy of the postings available to your account so you can search by role, employer, location, term and deadline, then read the full details in your assistant.

## What you can do

- Find opportunities that match your interests and study term.
- Compare requirements, locations and application deadlines.
- Ask what has appeared since your last search.
- Check when posting information was captured and refreshed.

Postings sync in the background, every four hours by default. Answers reflect the last successful sync; confirm live availability before applying. The service supports posting research and does not submit applications.

## Get started

You need an authorized OSCARplus Engineering Co-op account, an assistant that supports MCP, and either **Windows with Docker Desktop** or a Linux host with Docker Compose. The current login integration supports Microsoft's phone-call MFA.

1. [Deploy the service](docs/getting-started/deployment.md), or give your agent the [ready-to-copy setup prompt](docs/getting-started/setup-prompt.md).
2. [Connect your assistant and install the bundled skill](docs/getting-started/agent-setup.md).
3. Ask your assistant to find opportunities:

```text
Use the oscarplus skill to find embedded engineering co-op postings for
[term]. Check freshness first, then show five matches with requirements,
locations and deadlines. Read the full details before assessing fit.
```

The repository is private; you need access to clone it. Keep your credentials and posting data private, and run the service locally or on a trusted private network.

## Learn more

- [Login, credentials and MFA](docs/getting-started/authentication.md)
- [Documentation index](docs/README.md), including the tool reference, architecture and development guide
- [Terms and publication review](docs/project/terms-review.md)

Independent, unofficial project; not affiliated with or endorsed by McMaster University or Orbis Communications. Use your own authorized account and follow applicable portal terms.
