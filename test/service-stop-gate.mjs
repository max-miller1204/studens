import http from "node:http";
import fs from "node:fs";
if (process.argv[1]?.endsWith("/src/service-main.ts")) {
  const close = http.Server.prototype.close;
  http.Server.prototype.close = function (...args) {
    if (typeof this.address() !== "string") return Reflect.apply(close, this, args);
    fs.writeFileSync(process.env.STUDENS_STOP_GATE + ".closing", "");
    const end = Date.now() + 10000,
      word = new Int32Array(new SharedArrayBuffer(4));
    while (!fs.existsSync(process.env.STUDENS_STOP_GATE + ".release")) {
      if (Date.now() > end) throw Error("Stop gate timed out");
      Atomics.wait(word, 0, 0, 5);
    }
    return Reflect.apply(close, this, args);
  };
}
