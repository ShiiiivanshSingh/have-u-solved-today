<div align="center">
<img width="366" height="599" alt="Screenshot 2026-04-24 at 11 07 54 PM" src="https://github.com/user-attachments/assets/1b5e8860-bc0b-4b80-bd01-9c396d6acc90" />


# Have You Solved Today?

**A Chrome extension to track your daily LeetCode & Codeforces solving streak.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4f9cf9?style=flat-square&logo=googlechrome&logoColor=white)](https://github.com/ShiiiivanshSingh/have-u-solved-today)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-3ddc84?style=flat-square)](https://developer.chrome.com/docs/extensions/mv3/)
[![MIT License](https://img.shields.io/badge/License-MIT-c8ff57?style=flat-square)](LICENSE)

</div>

---

## ✨ Features

- 🔵 **LeetCode** + 🟡 **Codeforces** status tracked daily — did you solve or not?
- 📅 **Monthly calendar heatmap** — color-coded by platform (blue = LC, yellow = CF, green = both), with 4-level intensity based on how many problems you solved
- 🔥 **Streak counter** with animated milestone tiers (7d ✨ → 30d ⚡ → 100d 🔥 → 365d 👑)
- 🏆 **Best streak ever** tracked in storage
- 📊 **Monthly progress bar** — X out of Y days solved this month
- 🏅 **Contest ratings** shown on each card (LC contest rating + CF rating)
- 💡 **Daily hints** — personalized motivation based on your stats
- 🖱️ **Hover tooltips** on calendar cells — see what you solved on any day
- 👆 **Platform toggle** — click a legend dot to dim/hide that platform's days
- ⏰ **Smart nag notifications** — alerts you between 2 PM and midnight (at most once/hour) if you haven't solved yet
- 🎉 **Solve celebration** — instant notification the moment a problem is detected as solved
- 🔄 **Auto-refresh** every 2 hours in the background
- 🧹 **Auto storage cleanup** — prunes cache older than 30 days

---

## 🚀 Installation

Since this isn't on the Chrome Web Store yet, load it manually:

1. Clone or download this repo
   ```bash
   git clone https://github.com/ShiiiivanshSingh/have-u-solved-today.git
   ```
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the repo folder
5. The extension icon appears in your toolbar — click it and enter your usernames!

---

## 🎨 Calendar Colors

| Color | Meaning |
|---|---|
| 🔵 Blue | Solved on LeetCode only |
| 🟡 Yellow | Solved on Codeforces only |
| 🟢 Green | Solved on both platforms |
| 🔴 Red | Tracked but missed |
| Dimmed | Future date |

Heat intensity increases with number of problems solved (1 → 2–3 → 4–6 → 7+).

---

## 🛠 Tech Stack

- **Manifest V3** Chrome Extension
- Vanilla HTML / CSS / JavaScript — zero dependencies
- [LeetCode GraphQL API](https://leetcode.com/graphql)
- [Codeforces API](https://codeforces.com/apiHelp)
- `chrome.storage.local` for persistence
- `chrome.alarms` for background polling & notifications

---

## 📁 File Structure

```
extension/
├── manifest.json      # Extension config (MV3)
├── background.js      # Alarms: auto-refresh, solve poller, nag notifs
├── popup.html         # Main UI
├── popup.js           # All logic: API fetches, calendar, streak, ratings
├── popup.css          # Styling: dark theme, heatmap, animations
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🔔 Notifications

| Notification | When |
|---|---|
| 🎉 **Problem Solved!** | First solve detected on either platform (once/day) |
| ⏰ **Still unsolved** | Between 2 PM – midnight, at most once per hour if unsolved |

> Chrome must be running for notifications to fire. Allow Chrome notifications in **System Settings → Notifications** on macOS.

---

<div align="center">
  Made by <a href="https://github.com/ShiiiivanshSingh">@ShiiiivanshSingh</a> — stay consistent 🔥
</div>
