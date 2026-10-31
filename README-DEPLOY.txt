Riverbreaker - PWA for https://senssoft.com/river/
==================================================

What is inside
  index.html            the game (one file, all code inside)
  manifest.webmanifest  app name, icons, colors, screenshots
  sw.js                 service worker (offline cache)
  favicon.ico, icons/   app icons (any, maskable, apple touch, favicons)
  fonts/                Saira fonts, Latin subset (SIL Open Font License)
  screenshots/          used by the browser install dialog
  .htaccess             cache and MIME settings for Apache
  tools/                check.mjs, smoke.mjs, build.mjs (no dependencies)
  .github/workflows/    ci.yml (pull requests) and deploy.yml (master)
  DEPLOY-CI.md          automatic, least-privilege deployment over SSH

Requirements
  - HTTPS (service workers do not work on plain http, except localhost)
  - the files must be served from /river/ (the manifest id is /river/)

Install on Ubuntu (example for the web root /var/www/html)
  sudo mkdir -p /var/www/html/river
  sudo unzip -o river-pwa.zip -d /var/www/html/river
  sudo chown -R www-data:www-data /var/www/html/river

nginx: add this inside the server block of senssoft.com, then reload
  location = /river {
      return 301 /river/;
  }
  location /river/ {
      add_header Cache-Control "public, max-age=604800";
  }
  location ~ ^/river/(sw\.js|index\.html|manifest\.webmanifest)$ {
      add_header Cache-Control "no-cache";
  }
  sudo nginx -t && sudo systemctl reload nginx
  (nginx already knows the .webmanifest type in new versions. If
  the check below shows text/plain, add this line to the server block:
  types { application/manifest+json webmanifest; })

Apache: enable the modules once, the .htaccess file does the rest
  sudo a2enmod headers mime
  sudo systemctl reload apache2
  (the virtual host needs AllowOverride FileInfo for this folder)

Check after deploy
  curl -sI https://senssoft.com/river/manifest.webmanifest | grep -i content-type
  curl -sI https://senssoft.com/river/sw.js | grep -i cache-control
  Open https://senssoft.com/river/ once with internet, wait a few seconds,
  then switch off the network and reload. The game must still start.

Release a new version (manual publishing)
  1. Open a pull request. CI runs: node tools/check.mjs (structure, manifest,
     service worker, assets), node tools/smoke.mjs (headless gameplay test)
     and node tools/build.mjs (build into dist/). Merge when it is green.
  2. Build and upload by hand:
       node tools/build.mjs
       rsync -rlptz --checksum --delete --delay-updates dist/ user@host:/var/www/html/river/
     The build stamps sw.js with the commit id, so every player picks up the
     new version on the next launch.
  3. Copying the files without the build also works, but then bump VERSION in
     sw.js yourself (for example riverbreaker-v5), otherwise installed copies
     keep serving the old cache.
  4. Optional: the Deploy workflow does all of this over a restricted SSH key,
     but only when started manually (Actions -> Deploy -> Run workflow).
     Setup: DEPLOY-CI.md, Oracle Cloud: DEPLOY-ORACLE-UBUNTU.md.

  The same checks run locally:
     node tools/check.mjs && node tools/smoke.mjs && node tools/build.mjs

Notes
  - The first visit needs internet. After that the game works offline.
  - The best score is stored in the browser on each device.
  - iPhone: open the page in Safari, tap Share, then Add to Home Screen.
