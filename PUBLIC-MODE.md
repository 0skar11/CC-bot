# Public server mode

The repository may stay private while the Discord application supports public installation.

For a bot that can be used in any server where a server owner installs it, configure:

```dotenv
BOURSE_GUILD_IDS=*
ECONOMY_SCOPE_ID=YOUR_STABLE_DISCORD_SNOWFLAKE
```

`*` must appear by itself. Public mode requires an explicitly configured economy scope; it never chooses a server automatically. A stable application ID or an existing allowed guild ID can serve as the namespace. Keep the exact same `ECONOMY_SCOPE_ID` and database when moving hosts so wallets, holdings and market prices remain attached to the existing records. If converting an existing finite installation to public mode, retain its current scope.

After choosing public mode, run `npm run register` once. It registers exactly the stock command `/bourse` globally in the configured Discord application. Global commands become available in servers that install the app; Discord may take time to propagate changes. Typed stock aliases continue to work with Message Content Intent enabled.

With a comma-separated finite list instead, registration remains guild-only and the scope must belong to that list. An empty list permits no guilds. Switching modes does not clear previously registered commands in the other scope; remove stale guild/global registrations separately if necessary, using the intended application's settings.

Optional `BOURSE_CHANNEL_IDS` restrictions still apply in both modes. Direct messages, unsupported interactions, unrelated commands, and confirmations belonging to another member remain rejected. All public guilds intentionally share the same configured market and per-user CC/holdings namespace. They do not get separate economies automatically.

The Discord application's Public Bot setting and default install permissions are separate from this runtime switch. An invite requests permissions; each server owner must still authorize the installation.
