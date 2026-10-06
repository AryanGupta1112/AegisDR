# Start here

AegisDR keeps copies of your app's files and records. If data is lost, you can bring it back from one of those copies.

## Open the app

From the project folder, run this Windows command:

```powershell
.\scripts\start.ps1
```

Open **http://127.0.0.1:8088**. Keep the terminal open while using the app. Press **Ctrl+C** to stop it. Your backups stay saved.

## Try it with sample notes

1. Open **My apps → Atlas Notes**. This is the practice app.
2. Add a note, then click **Back up now**. Wait for the task to say **Done**.
3. Add another note. This newer note is not in your earlier backup.
4. Open **Backups**, choose the earlier backup and click **Restore**.
5. Read what will be replaced. Type the confirmation exactly as shown, then confirm.
6. Check the notes again. They now match the earlier backup. A safety backup keeps the version from just before the restore.

Use **Practice recovery** to try losing sample notes or checking a damaged backup copy. These exercises only use the practice app.

## Find your way around

| Page | What it does |
| --- | --- |
| Home | Shows your latest backup and recent tasks |
| My apps | Shows each app and its backup settings |
| Backups | Saves, checks and opens your backup copies |
| Restore | Brings data back from a saved backup |
| Restore history | Shows what was restored and the result |
| Practice recovery | Lets you learn safely with sample data |
| Servers | Connects optional Kubernetes tools; unnecessary for basic backups |
| Reports | Shows storage use and how long tasks took |
| Recent activity | Lists changes and results |
| Settings | Changes schedules and screen animation preferences |

**Maximum data age** is how old you are willing to let a backup become. **Target restore time** is how quickly you hope to bring data back. Goals are settings; actual results appear only after a task runs.

## Make it comfortable

Use the sun/moon button for a white or black background. You can collapse the sidebar. In **Settings**, choose **Reduce movement** to turn off screen motion. These display choices are remembered on this device. Passwords and backup records are not saved in your browser's local storage.

For adding your own database, Docker, or optional server setup, use the [technical guide](../README.md). Start with the sample app if you are unsure which data to protect.
