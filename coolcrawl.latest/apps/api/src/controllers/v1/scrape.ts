import { Request, Response } from "express";
import { WebScraperDataProvider } from "../../scraper/WebScraper";
import { billTeam, checkTeamCredits } from "../../services/billing/credit_billing";
import { authenticateUser } from "../auth";
import { RateLimiterMode } from "../../types";
import { logJob } from "../../services/logging/log_job";
import { Document } from "../../lib/entities";
import { isUrlBlocked } from "../../scraper/WebScraper/utils/blocklist"; // Import the isUrlBlocked function

export async function scrapeHelper(
  req: Request,
  team_id: string,
  crawlerOptions: any,
  pageOptions: any
): Promise<{
  success: boolean;
  error?: string;
  data?: Document;
  returnCode: number;
}> {
  const url = req.params.url;
  if (!url) {
    return { success: false, error: "Url is required", returnCode: 400 };
  }

  if (isUrlBlocked(url)) {
    return { success: false, error: "Social media scraping is not support  due to policy restrictions.", returnCode: 403 };
  }

  const a = new WebScraperDataProvider();
  await a.setOptions({
    mode: "single_urls",
    urls: [url],
    crawlerOptions: {
      ...crawlerOptions,
    },
    pageOptions: pageOptions,
  });

  const docs = await a.getDocuments(false);
  // make sure doc.content is not empty
  const filteredDocs = docs.filter(
    (doc: { content?: string }) => doc.content && doc.content.trim().length > 0
  );
  if (filteredDocs.length === 0) {
    return { success: true, error: "No page found", returnCode: 200 };
  }

  const billingResult = await billTeam(
    team_id,
    filteredDocs.length
  );
  if (!billingResult.success) {
    return {
      success: false,
      error:
        "Failed to bill team. Insufficient credits or subscription not found.",
      returnCode: 402,
    };
  }

  return {
    success: true,
    data: filteredDocs[0],
    returnCode: 200,
  };
}

export async function scrapeController(req: Request, res: Response) {
  try {
    // make sure to authenticate user first, Bearer <token>
    const { success, team_id, error, status } = await authenticateUser(
      req,
      res,
      RateLimiterMode.Scrape
    );
    if (!success) {
      return res.status(status).json({ error });
    }
    const crawlerOptions = {};
    const pageOptions = { onlyMainContent: false };
    const origin = "api";

    try {
      const { success: creditsCheckSuccess, message: creditsCheckMessage } =
        await checkTeamCredits(team_id, 1);
      if (!creditsCheckSuccess) {
        return res.status(402).json({ error: "Insufficient credits" });
      }
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Internal server error" });
    }
    const startTime = new Date().getTime();
    const result = await scrapeHelper(
      req,
      team_id,
      crawlerOptions,
      pageOptions
    );
    const endTime = new Date().getTime();
    const timeTakenInSeconds = (endTime - startTime) / 1000;
    logJob({
      success: result.success,
      message: result.error,
      num_docs: 1,
      docs: [result.data],
      time_taken: timeTakenInSeconds,
      team_id: team_id,
      mode: "scrape",
      url: req.params.url,
      crawlerOptions: crawlerOptions,
      pageOptions: pageOptions,
      origin: origin,
    });
    return res.status(result.returnCode).json(result);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
}
