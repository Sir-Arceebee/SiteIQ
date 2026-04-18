
The user is hitting an npm peer-dep error locally. `react-leaflet@4.2.1` requires React 18, project has React 19. The code doesn't actually use `react-leaflet` (only vanilla `leaflet`), so removing it is safe.

## Plan

**Remove `react-leaflet` from `package.json`** — it's an unused dependency causing the install conflict. `src/components/SiteMap.tsx` uses vanilla `leaflet` directly via refs, so nothing breaks.

After I make the change, on your machine run:
```
rm package-lock.json node_modules -rf
npm install
```

(Or just `npm install` — should resolve cleanly once the bad dep is gone.)

If you'd rather not wait, you can also unblock yourself right now with `npm install --legacy-peer-deps`, but the proper fix is removing the unused package.
