const https = require('https');

const payload = JSON.stringify({ channelName: 'test-room', uid: 'test-uid' });

const opts = new URL('https://pndfytihpwpdhkramuvm.functions.supabase.co/agora-token-relaxed');

const options = {
  hostname: opts.hostname,
  path: opts.pathname,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => (body += chunk));
  res.on('end', () => {
    console.log('status:', res.statusCode);
    try {
      console.log(JSON.stringify(JSON.parse(body), null, 2));
    } catch (e) {
      console.log('raw body:', body);
    }
  });
});

req.on('error', (e) => console.error('request error:', e));
req.write(payload);
req.end();
