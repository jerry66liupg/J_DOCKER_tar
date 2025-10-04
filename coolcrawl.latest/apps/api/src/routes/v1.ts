import express from "express";
import { scrapeController } from "../../src/controllers/v1/scrape";

export const v1Router = express.Router();

v1Router.get("/v1/scrape/:url(*)", scrapeController);
