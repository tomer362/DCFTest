# Demodaran-Style DCF Calculator

This repository contains a static browser app for generating an LLM-friendly DCF prompt and calculating valuation outputs from structured JSON assumptions.

## Deploy

A GitHub Actions workflow is included at `.github/workflows/deploy.yml` to deploy this static site to GitHub Pages.

### One-time setup

1. Push this repository to GitHub.
2. In **Settings → Pages**, set **Build and deployment** to **GitHub Actions**.
3. Ensure your default branch is `main` (or update the workflow branch trigger accordingly).

### Automatic deploys

- Every push to `main` triggers a deploy.
- You can also trigger deployment manually from the **Actions** tab using **workflow_dispatch**.

After deployment, the site is available at the Pages URL shown in the workflow run summary.
