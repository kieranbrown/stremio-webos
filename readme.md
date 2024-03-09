# Stremio WebOS

Disclaimer: Yes, this is just a hosted web app and
it may not be for you.

This is designed for those who don't want
to spend money on a ad-filled Firestick or other
streming device when they have a perfectly good LG TV
sat in their living room ready to use.

If you already have such a device, then this probably
isn't for you.

## Prerequisites

> If you have your TV rooted your installation might be slightly different, follow [this guide](https://www.webosbrew.org/pages/sdk-configuration.html#configuring-webososeares-cli-with-rooted-tv) to enable SSH and ignore the Developer Mode steps.

1. Clone this repo

2. [Install the Developer Mode App](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app#installing-developer-mode-app)

3. [Turn Developer Mode On](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app#turning-developer-mode-on)

4. [Install the ares CLI](https://github.com/webos-tools/cli#installation)

5. Follow the [Connecting with CLI](https://webostv.developer.lge.com/develop/getting-started/developer-mode-app#connecting-with-cli) docs to add your TV configuration to the CLI
    - Remember the device name you use during setup
    as you'll need this when packaging and deploying

## App Installation

Once you have your TV and CLI ready, the final steps
are to package and install the app.

### Package Command

`ares-package -e "cli" -e ".gitignore" -e "readme.md" .`

### Install Command

> Replace `tv2` with the device name you used during setup.

`ares-install --device tv2 ./com.stremio.web_1.0.0_all.ipk`

---

Congratulations, now you have Stremio installed on
your TV.

Open the app, connect your account and start watching :)

## Post Installation Instructions

If your TV is not rooted (which isn't possible anymore)
you will have to find a method to extend Dev Mode
automatically as it expires after 1000 hours and any
custom apps will be uninstalled.

Unfortunately, I don't have any recommendations on the
best approach as my TV is rooted, however the following
links might give some guidance.

- https://www.reddit.com/r/jellyfin/comments/ryowwb/i_created_a_simple_script_to_renew_the_devmode_on/

- https://www.youtube.com/watch?v=Q9dIlRHJP_s