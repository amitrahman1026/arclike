# How the command bar ranks results

The command bar shows up to 8 rows, and Enter opens the first row. The rows come from open tabs, recently closed tabs, bookmarks, the last 90 days of history, commands, and Google's search suggestions.

An empty bar lists the tabs you were on most lately, newest first, as in Arc. These are the tabs that Ctrl+Tab offers. Chrome's top sites fill the rest of the 6 rows.

The ranking copies the design of Arc's command bar. Each page gets a few features, each a number from 0 to 1. A score combines them, and the best page goes first if it is good enough. Otherwise the search row goes first. The bar also remembers what you chose for what you typed.

The code is in `extension/ranking.js` (features, scores, memory) and `commandBarRank` in `extension/commandbar.js` (rows and order).

## Steps

1. Find the pages that match. A page matches when its title or URL contains every word of the query. When fewer than 3 pages match and the query has 4 or more letters, a second pass also accepts typos.
2. Add the pages that you chose before for this text, even when they do not match.
3. Give each page its features, and compute its score.
4. Merge copies of the same page. An open tab that is also in history keeps the best value of each feature.
5. Sort the pages by score, and choose the first row.

<details>
<summary>Typos</summary>

A word of 4 to 7 letters can have one typo, and a word of 8 or more letters can have two. A shorter word must match exactly. A typo can swap the first two letters but cannot change the first letter.

</details>

## Score

The score is a weighted average of how well a page matches and how much you use it. Bonuses for where the page is come on top.

| Feature | Value | Weight |
|---|---|---|
| host | 1 if the site's name starts with the query, 0.5 if a subdomain does | 3 |
| title | 1 if the title starts with the query, 0.5 if a later word does | 1 |
| coverage | How much of the site's name or title the query covers | 1 |
| exact | 1 if the page matched without typos | 1.6 |
| frequency | Visits on a log scale, 1 at 100 visits | 1.5 |
| typed | Times you typed the address, 1 at 5 times | 1 |
| recency | Halves every day since the last visit | 0.02 |

| Bonus | Value | Added |
|---|---|---|
| tab | 1 for an open tab | 0.3 |
| closed | 1 for a recently closed tab | 0.1 |
| bookmark | 1 for a bookmark | 0.05 |
| switched | 1 for the tab you were on before this one, then 1/2, 1/3, and so on, by Ctrl+Tab order | 0.1 |
| remembered | How strongly the memory suggests the page (see [Memory](#memory)) | 1.25 |

The bonuses are not weights for a reason. Most pages have 0 for them. As weights, they would lower the score of every page, so fewer pages would reach the lead score.

Recency has a small weight because Arc's data showed that how often you visit a page predicts your choice better than how recently. The weight only breaks ties.

## The first row

The bar checks these in order. The first that applies chooses the first row. A page never leads for a query of one letter.

When the query ends in a space, the bar lists only searches, as in Arc: the search row, one past search, and search suggestions. For example, `youtube` gives your YouTube tab, and `youtube ` searches for youtube. The field does not complete a query that ends in a space.

1. The query is an address, such as `github.com/me`. The first row opens it in a new tab, even when a tab has it open, as in Arc. Thus you can open a page a second time. The tab comes lower in the list.
2. The best page leads when all of these are true:
   - Its score is 0.5 or more.
   - The query starts its site's name or a word of its title, or you chose it for this text before.
   - You did not choose to search this exact text more strongly before.
3. A tab that you closed in the last 10 minutes leads when the query starts its site's name or its title.
4. The query is one word that is a site's name with a typo, and the bar found no good match without typos. The site leads, in a new tab, if you use it. A site you use is open in a tab, bookmarked, typed once, or visited 3 or more times. For example, `godbold` gives `godbolt.org/`. A typo of any other word leaves the search row first.
5. A command whose name starts with the query leads when the query has 3 or more letters. For example, `set` gives Settings.
6. Otherwise, the search row leads.

When a page from history or bookmarks leads and its site's name starts with the query, the first row is the site itself. For example, `you` gives `youtube.com/`, and the field completes the name. A tab, a closed tab, or a remembered page leads as itself.

After the first row come the search row, one past search, up to 2 commands, and then the other pages by score.

Search suggestions come last. They fill up to 3 of the free rows, or 5 after a space. The bar shows its rows first and adds the suggestions when Google answers, so no row moves under the selection. The bar does not ask for suggestions in incognito windows or for an address. The extension's popup has a setting to turn them off.

## Memory

When you choose a row, the bar stores what you typed, what you chose, when, and how many times. It keeps the newest 2000 choices in `chrome.storage.local`. It does not store commands or typed addresses, because the bar finds those the same way every time. It also does not store a choice for a query that ends in a space, because the space chose the search.

A stored choice applies when the text you typed then starts with the query. Its strength is:

```
(query length / stored text length)³ × min(1, 0.6 + 0.2 × (count − 1)) × 0.5^(age in days / 14)
```

The cube makes the memory strong for the same text and weak for a short start of a long text. A choice for `github` counts 8 times as much when you type `github` again as when you type `git`.

A stored search does not change the score of a page:

- A search for the exact query keeps the search row first, unless a page was chosen more strongly.
- A search for a longer text shows as a past-search row below the search row.

To remove a page or a past search from the bar, select its row and press `Shift+Fn+Delete` on a Mac or `Shift+Delete` on Windows, or click its **×**. A page leaves Chrome's history and the memory. A past search leaves the memory. Open tabs, closed tabs, bookmarks, and the search row for the query cannot be removed.

**Import from Arc** adds the choices from Arc's command bar to the memory, so the bar knows your Arc habits from the start. A second import adds only the new choices.

## How the weights were chosen

`tools/rank-eval.cjs` tests the ranking against the choices in Arc's command bar. It replays each choice against Arc's history as it was at that time. Only earlier choices are in the memory. Then it checks if the first row is the page you chose, or the search row for a search.

On 1313 choices:

| | Old ranking | Current ranking |
|---|---|---|
| Chosen page is the first row | 39.6% | 53.3% |
| Chosen page is in the first 3 rows | 57.4% | 64.5% |
| Search row is first for a search | 99.8% | 99.6% |

Arc keeps only the last choice for each text. So the test cannot show what happens when you type the same text again, which is where the memory helps most. Unit tests in `tests/commandbar.test.cjs` cover that case.

<details>
<summary>Run the test and tune the weights</summary>

You need Arc's data on this Mac and `sqlite3`. The folder holds copies of your history, so keep it outside the repository.

```bash
node tools/rank-eval.cjs prepare ~/arclike-eval
node tools/rank-eval.cjs run ~/arclike-eval
node tools/rank-eval.cjs run ~/arclike-eval --old
node tools/rank-eval.cjs tune ~/arclike-eval
```

`run --old` tests the ranking in git `HEAD`, for a before and after. `tune` changes one weight at a time and keeps each change that helps. It does not tune the tab, closed, bookmark, and switched bonuses, because Arc's data has no tabs or bookmarks.

</details>
