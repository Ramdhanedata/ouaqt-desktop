# ouaqt-desktop

The software that runs on the shop counter. The builder on the OUAQT website
configures it; this app is what a cashier uses all day, with no internet.

```bash
git clone --recurse-submodules <this repo>
npm install
npm run dev            # Vite plus Electron
npm test               # this repo's own tests
npm run check:db       # the database, under Electron's node
npm run build          # main process, preload, renderer
```

`app-ui` comes from the website repo as a submodule in `vendor/`. Shared
screens are changed **there**, never here, so the builder's preview and this
app never drift apart.

See `docs/DESKTOP.md` for how the configuration drives the app, and
`vendor/ouaqt-website/docs/` for the licence contract and the screen rules.
