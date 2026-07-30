/** Browser / terminal dev server. */
const WEB_PORT = 4000;

/** Packaged desktop app — obscure port to avoid clashing with bun dev on 4000. */
const APP_PORT = 47_831;

module.exports = { WEB_PORT, APP_PORT };
