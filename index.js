/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */



import dotenv from "dotenv";
dotenv.config();

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({});



// ------------------- AI Pull Request Review Generator -------------------
async function generatePrReview({ title, body, diff }) {
  try {
    const prompt = `
You are an experienced senior code reviewer.  
You have the following pull request to review:

Pull Request Title: ${title}
Pull Request Description: ${body || "(empty)"}

Here is the git diff of the changes introduced by this PR:  
\`\`\`diff
${diff}
\`\`\`

Your tasks:  
1. Summarize in a few sentences **what this PR does**.  
2. Perform a **code review**, focusing on:
   - Potential bugs or logical errors  
   - Code quality and style issues (readability, maintainability, naming, duplication, complexity)  
   - Security vulnerabilities or risky code patterns (if any)  
   - Performance issues or inefficiencies (if relevant)  
   - Missing or inadequate test coverage / lack of tests  
   - Missing documentation or comments when needed

3. For each issue found, provide:
   - A clear explanation of the problem  
   - A suggestion how to fix it (or improve it) — with example code snippets or refactoring suggestions if appropriate  

4. If no major issues found — you can say the PR looks good, but optionally suggest improvements (e.g. readability, tests, documentation).

Return your review in **Markdown format**, structured with headings:
## Summary  
## Bugs / Issues  
## Suggestions & Improvements  
## Optional Notes  

---

Be objective, professional, and concise.  
`;
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt
    });

    return response.text;
  } catch (error) {
    console.log("AI ERROR:", error);
    return "🤖 Oops… My humor module crashed!";
  }
}





export default (app) => {
  app.on("pull_request.opened", async (context) => {
    const pr = context.payload.pull_request
    const title = pr.title
    const body = pr.body
    const diff_url = pr.diff_url

    //fetch diff file
    const response = await context.octokit.request({
      method: 'GET',
      url: diff_url,
      headers: {
        accept: 'application/vnd.github.v3.diff'
      }
    });

    const diff = response.data;  

    //generate pull request review
    const prReview = await generatePrReview({ title, body, diff });

    // post the review as a comment on the PR
    await context.octokit.rest.issues.createComment(
      context.issue({ body: prReview })
    );


  });
};


