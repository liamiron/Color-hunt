# Supabase Setup Guide — Color Hunt

## 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New Project**.
3. Choose a name (e.g. `color-hunt`), set a database password, pick your region.
4. Wait ~2 minutes for the project to provision.

---

## 2. Run the Database Schema

1. In the Supabase dashboard, go to **SQL Editor**.
2. Click **New Query**.
3. Paste the contents of `supabase/schema.sql` and click **Run**.
4. Confirm the tables `groups`, `quests`, and `photos` were created (check **Table Editor**).

---

## 3. Run the Policies

1. In **SQL Editor**, create another new query.
2. Paste the contents of `supabase/policies.sql` and click **Run**.

> **Note:** If you get an error about the `storage.buckets` insert, that's OK — just create the bucket manually in step 4.

---

## 4. Create the Storage Bucket

1. Go to **Storage** in the sidebar.
2. Click **New Bucket**.
3. Name it `photos`.
4. ✅ Check **Public bucket** (so image URLs work without auth).
5. Click **Save**.

---

## 5. Get Your API Keys

1. Go to **Project Settings** → **API**.
2. Copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon/public key** (the long `eyJ...` string)

---

## 6. Configure the App

1. In the project root, copy `.env.example` to `.env`:
   ```
   cp .env.example .env
   ```
2. Open `.env` and fill in your keys:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

---

## 7. Run the App

```bash
npm run dev
```

The app will be available at:
- **Local:** `http://localhost:5173`
- **Mobile (same Wi-Fi):** `http://<your-LAN-IP>:5173`

To find your LAN IP on Windows:
```powershell
ipconfig
# Look for "IPv4 Address" under your Wi-Fi adapter
```

---

## 8. Configure Social Auth (Google & Facebook)

To allow users to sign in with Google or Apple, you must configure the OAuth providers in Supabase. The front-end code is already wired up to use them.

### Google Setup

1. **Get Google Credentials:**
   - Go to the [Google Cloud Console](https://console.cloud.google.com/).
   - Create a new project or select an existing one.
   - Go to **APIs & Services** > **OAuth consent screen** and configure it (choose "External" if you don't have a Google Workspace).
   - Go to **Credentials**, click **Create Credentials** > **OAuth client ID**.
   - Application type: **Web application**.
   - Authorized JavaScript origins: Add your app's base URL (e.g., `http://localhost:5173` for dev, and your production URL).
   - Authorized redirect URIs: Add your Supabase project's redirect URL. You can find this in Supabase: **Authentication** > **URL Configuration** > **Site URL** (e.g., `https://xxxx.supabase.co/auth/v1/callback`).
   - Copy the **Client ID** and **Client Secret**.

2. **Configure Supabase:**
   - Go to your Supabase Dashboard.
   - Navigate to **Authentication** > **Providers**.
   - Click on **Google** and enable it.
   - Paste the **Client ID** and **Client Secret**.
   - Click **Save**.

### Facebook (Meta) Setup

1. **Get Facebook Credentials:**
   - Go to the [Meta for Developers](https://developers.facebook.com/) portal.
   - Click **My Apps** and create a new App (type: "Allow people to log in with their Facebook account").
   - Go to **App Settings** > **Basic**.
   - Copy your **App ID** (Client ID) and **App Secret** (Client Secret).
   - In the left sidebar, add the **Facebook Login** product to your app.
   - Under **Facebook Login** > **Settings**, add your Supabase Return URL to the **Valid OAuth Redirect URIs** (e.g., `https://xxxx.supabase.co/auth/v1/callback`).
   - Save your changes.

2. **Configure Supabase:**
   - Go to your Supabase Dashboard.
   - Navigate to **Authentication** > **Providers**.
   - Click on **Facebook** and enable it.
   - Paste the **App ID** as the Client ID, and **App Secret** as the Client Secret.
   - Click **Save**.
