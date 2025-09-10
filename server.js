const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const cron = require('node-cron');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// plaid
const configuration = new Configuration({
  basePath: PlaidEnvironments.production,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});
const plaidClient = new PlaidApi(configuration);

// db - pi location
const db = new sqlite3.Database('/home/pi/nova/data.db');

// tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    wells_fargo_checking REAL DEFAULT 0,
    wells_fargo_credit REAL DEFAULT 0,
    robinhood REAL DEFAULT 0,
    vanguard REAL DEFAULT 0,
    net_worth REAL DEFAULT 0,
    is_ath BOOLEAN DEFAULT 0
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY,
    institution TEXT UNIQUE NOT NULL,
    access_token TEXT NOT NULL
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS ath (
    id INTEGER PRIMARY KEY,
    value REAL NOT NULL,
    date TEXT NOT NULL
  )`);
});

// ath
async function getATH() {
  return new Promise((resolve, reject) => {
    db.get("SELECT value FROM ath ORDER BY value DESC LIMIT 1", (err, row) => {
      if (err) reject(err);
      resolve(row ? row.value : 0);
    });
  });
}

async function updateATH(value, date) {
  return new Promise((resolve, reject) => {
    db.run("INSERT OR REPLACE INTO ath (id, value, date) VALUES (1, ?, ?)", 
      [value, date], (err) => {
        if (err) reject(err);
        resolve();
    });
  });
}

// pull
async function fetchBalances() {
  const balances = {
    wells_fargo_checking: 0,
    wells_fargo_credit: 0,
    robinhood: 0,
    vanguard: 0
  };
  
  const tokens = await new Promise((resolve, reject) => {
    db.all("SELECT * FROM tokens", (err, rows) => {
      if (err) reject(err);
      resolve(rows || []);
    });
  });
  
  for (const token of tokens) {
    try {
      const response = await plaidClient.accountsBalanceGet({
        access_token: token.access_token
      });
      
      for (const account of response.data.accounts) {
        if (token.institution === 'wells_fargo') {
          if (account.subtype === 'checking') {
            balances.wells_fargo_checking = account.balances.current || 0;
          } else if (account.subtype === 'credit card') {
            balances.wells_fargo_credit = account.balances.current || 0;
          }
        } else if (token.institution === 'robinhood') {
          balances.robinhood += account.balances.current || 0;
        } else if (token.institution === 'vanguard') {
          balances.vanguard += account.balances.current || 0;
        }
      }
    } catch (error) {
      console.error(`${token.institution} fail:`, error);
    }
  }
  
  balances.net_worth = balances.wells_fargo_checking + 
                       balances.robinhood + 
                       balances.vanguard - 
                       balances.wells_fargo_credit;
  
  return balances;
}

// daily
async function storeDailySnapshot() {
  const balances = await fetchBalances();
  const date = new Date().toISOString().split('T')[0];
  const currentATH = await getATH();
  const isATH = balances.net_worth > currentATH;
  
  if (isATH) {
    await updateATH(balances.net_worth, date);
  }
  
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO balances (date, wells_fargo_checking, wells_fargo_credit, 
            robinhood, vanguard, net_worth, is_ath) 
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [date, balances.wells_fargo_checking, balances.wells_fargo_credit,
       balances.robinhood, balances.vanguard, balances.net_worth, isATH ? 1 : 0],
      (err) => {
        if (err) reject(err);
        console.log(`${date}: $${balances.net_worth.toFixed(2)}${isATH ? ' 🎯' : ''}`);
        resolve(balances);
      }
    );
  });
}

// routes

app.post('/api/link/token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'nova-user' },
      client_name: 'Nova',
      products: ['accounts', 'balances'],
      country_codes: ['US'],
      language: 'en',
    });
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/link/exchange', async (req, res) => {
  const { public_token, institution } = req.body;
  
  try {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token
    });
    
    db.run("INSERT OR REPLACE INTO tokens (institution, access_token) VALUES (?, ?)",
      [institution, response.data.access_token],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      }
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const balances = await storeDailySnapshot();
    res.json(balances);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/history', (req, res) => {
  const days = parseInt(req.query.days) || 90;
  db.all(`SELECT * FROM balances WHERE date >= date('now', '-${days} days') ORDER BY date ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
});

app.get('/api/ath', async (req, res) => {
  try {
    const ath = await getATH();
    res.json({ value: ath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6am
cron.schedule('0 6 * * *', () => {
  storeDailySnapshot();
});

app.listen(3000, () => {
  console.log('nova up');
});