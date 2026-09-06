# Inventory — garment style axes

Screenshots for the training documents, captured from the running application
rather than mocked up, so they cannot quietly stop matching the screen. To
regenerate after a UI change:

```bash
cd frontend && npm run generate:screenshots
```

The capture lives in `frontend/src/e2e/capture-inventory-style-docs.spec.ts`.

| Image                         | Shows                                                                  | Caption to use                                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `01-one-garment-one-item.png` | Add Item with **Long Sleeve + Men's + Polo** picked, one per style row | One pick per row describes one garment. Three style chips still create **one** item.                                       |
| `02-two-fits-two-items.png`   | The same, plus **Women's**                                             | Two picks in the _same_ row create one item each — a men's and a women's polo.                                             |
| `03-size-groups.png`          | The Sizes rows                                                         | Sizes are grouped too: garment letters, boot/glove numbers, and waist sizes.                                               |
| `04-single-item-style.png`    | Add Item with generation switched off                                  | A single item records its style the same way, so a garment created — or generated — with the wrong style can be corrected. |
| `05-list-and-filters.png`     | The item list                                                          | The whole style reads as one label, and the Styles filter is grouped by row, so "Long Sleeve" finds this polo.             |

## The rule these illustrate

The ten style values are **four separate questions**, not ten alternatives:

- **Sleeve** — Short Sleeve, Long Sleeve
- **Fit** — Men's, Women's, Unisex
- **Neckline** — V-Neck, Crew Neck, Polo, Button Down
- **Closure** — Quarter Zip

Answer each at most once. Picking a second answer in the **same** row is what
creates an extra item, because that genuinely is a second garment. Picking one
answer in a **different** row just describes the same garment more precisely.
