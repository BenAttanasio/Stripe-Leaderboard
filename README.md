# Stripe Leaderboard

## Setup

Flash Pi OS to SD. SSH in.

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
git clone [repo]
cd nova
mkdir -p /home/pi/nova
npm install
```

## Plaid

Get production keys at plaid.com. Add to `.env`.

## Run

```bash
sudo npm install -g pm2
pm2 start server.js --name nova
pm2 startup
pm2 save
```

## Kiosk

```bash
sudo nano /etc/xdg/lxsession/LXDE-pi/autostart
```

Add:
```
@chromium-browser --kiosk --noerrdialogs --disable-infobars http://localhost:3000
```

## Use

Link banks. Watch numbers.
