import type { Chapter } from "../core/types.ts";
import { ch01 } from "./ch01-flow/chapter.ts";
import { ch02 } from "./ch02-subnet/chapter.ts";
import { ch03 } from "./ch03-transport/chapter.ts";
import { ch04 } from "./ch04-port/chapter.ts";
import { ch05 } from "./ch05-dns/chapter.ts";
import { ch06 } from "./ch06-http/chapter.ts";
import { ch07 } from "./ch07-tls/chapter.ts";
import { ch08 } from "./ch08-lb/chapter.ts";
import { ch09 } from "./ch09-diagnose/chapter.ts";

export const chapters: Chapter[] = [ch01, ch02, ch03, ch04, ch05, ch06, ch07, ch08, ch09];
