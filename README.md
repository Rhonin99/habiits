# Habits — offline habit tracker (iPhone web app)

A private habit tracker that installs on your iPhone home screen. You don't need the App Store, a Mac, or a developer account, and nothing expires. All data stays on the phone.

## Features

- **Habit types:** daily, weekly, or monthly goals with any amount and unit, for example 3 L/day, 3 times/week or 8 times/month. Daily habits can be limited to certain weekdays.
- **Habit button:** each habit chooses what its button does:
  - **Mark done:** one tap completes the goal; tap again to undo.
  - **Add amount:** each tap adds a set amount, such as 1 L.
  - **Keypad:** pops up a keypad so you can enter any amount, such as 1 L now and 0.5 L later.
- **Reordering:** hold a habit to pick it up, then drag. Finished habits drop to the bottom of the list on their own.
- **Skip for a day:** swipe a habit left to skip it. You're asked whether an anomaly caused it. Skipped days don't count against completion or streaks. Swipe again to unskip.
- **Weekly review:** in Stats → Weekly review you get:
  - completion vs last week
  - a day-by-day chart
  - highlights: best habit, the one that needs attention, most improved, anomaly days vs normal days, and maximums you went over
  - each habit's 7 days at a glance
  - a banner on Today at the start of each week
- **Goal types:**
  - **Minimum:** a habit to increase, such as water of at least 3 L/day.
  - **Maximum:** a habit to reduce, such as Instagram of at most 30 min/day.
  - **Min & max:** something you enjoy but can overdo, such as gaming between 20 and 60 min/day.
- **Anomalies:** one-off events that knocked your routine off, such as a late night out. Each day's anomalies show as bubbles at the bottom of Today, as a dot on the week strip, in Stats → "Anomalies this month", and next to each habit's recent logs.
- **Streaks:** current and best streak for every habit.
- **Heatmaps:** a calendar heatmap for each habit, plus an overall heatmap of the last 6 months.
- **Monthly dashboard:** completion %, perfect days, check-ins and top streak, and for each habit its month calendar, completion rate and totals.
- **Groups:** filter by group with the pink pill at the top left.
- **Subhabits:** a parent habit is complete when all of its subhabits are done.
- **Integrations:** Apple Health, Mi Fitness and app screen time, through the iOS Shortcuts app (see below).
- **Reminders:** added as repeating Calendar events with an alert.
- **Backups to iCloud Drive:** a reminder banner (daily or weekly) runs a "Habit Backup" shortcut that saves a dated file to iCloud Drive → Shortcuts → Habit Backups. You can also save a file manually from the share sheet. Restore from Settings.

## Run it on your computer

```bash
node tools/serve.mjs
```

Then open http://localhost:5173.

## Put it on your iPhone

The app has to be served over **HTTPS** before iOS will install it. GitHub Pages does this for free:

1. Create a GitHub repository and push this folder to it.
2. In the repository, go to **Settings → Pages → Build and deployment**. Choose **Deploy from a branch**, then branch `main`, folder `/ (root)`.
3. After about a minute it's live at `https://<your-username>.github.io/<repo-name>/`.
4. On your iPhone, open that URL in **Safari**. Tap **Share → Add to Home Screen**.

Netlify Drop (drag the folder onto app.netlify.com/drop) or Cloudflare Pages also work.

**Updating:** after changing files, bump `VERSION` in `sw.js` (e.g. `habits-v2`) and redeploy. The app shows **Update available → Reload**.

**Your data:** it lives in the home-screen app's own storage. Deleting the home-screen icon deletes the data, so use **Settings → Export backup** now and then. Safari and the home-screen app keep **separate** storage.

## Integrations, and why they go through Shortcuts

iOS doesn't let web apps read HealthKit or Screen Time. The **Shortcuts** app can, so it acts as the bridge:

| What | Direction | How |
|---|---|---|
| Mi Band steps/workouts/sleep | Mi Fitness → Apple Health → app | Turn on Apple Health sync in Mi Fitness. The **Habit Sync** shortcut reads Health and copies a summary. In the app, tap **Sync**, then **Paste**. |
| Sleep you log in the app | app → Apple Health | Set the habit's **Run shortcut after logging** to `Log Sleep`. After logging, tap **Send ❤️**. |
| Time in Instagram (any app) | iPhone → app | Shortcuts automations log each time the app opens and closes. Sync adds up the minutes. |

Step-by-step instructions are in the app under **Settings → Setup guides**.

The sync text format is in [`js/integrations.js`](js/integrations.js). A `key=value` line fills any habit whose **Data source** or **name** matches the key.

**Not done yet:** tracking laptop activity. The phone and laptop can't share local data without a small sync service, which would be the next step.

## Files

```
index.html             app shell + tab bar
css/app.css            all styles (light + dark)
js/app.js              boot, routing, event handling, logging, sync flow
js/store.js            data model + localStorage persistence
js/logic.js            progress, streaks, monthly stats
js/views.js            Today / Stats / Habits / Settings screens
js/sheets.js           habit editor, habit detail, keypad, skip-reason sheets
js/gestures.js         hold-to-reorder and swipe-to-skip on habit cards
js/components.js       rings, heatmaps, sheets, toasts, icons
js/integrations.js     Shortcuts bridge, sync parser, calendar reminders
sw.js                  offline cache
tools/serve.mjs        local dev server
tools/make-icons.mjs   regenerates icons/*.png
```
