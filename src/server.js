import { createApp } from './app.js';

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

createApp().listen(port, host, () => {
  console.log(`Decision Wheel is listening at http://${host}:${port}`);
});
