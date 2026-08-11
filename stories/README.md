# Stories

This folder holds the contract for every change in Moneymentum. User-facing
stories and internal dev stories (refactors, migrations, foundations) share a
single hex-indexed sequence so they sort and cross-reference consistently. A
story is scoped to the value it delivers and may span as many PR-sized GitHub
issues as it needs.

Current focus: make the app usable in production, then expand portfolio beta
from Hyperliquid-only positions to read-only wallets and protective hedges.

## Completed

- [Select Perps From The Screener](./0x001.select-perps-from-screener.md)
- [Edit Target Position Allocations](./0x002.edit-target-position-allocations.md)
- [Adjust Account Leverage](./0x003.adjust-account-leverage.md)
- [Preview Staged Rebalance Trades](./0x004.preview-staged-rebalance-trades.md)
- [Execute Rebalance](./0x005.execute-rebalance.md)
- [Protect Invalid Rebalances](./0x006.protect-invalid-rebalances.md)
- [Persist Draft Portfolio Targets](./0x007.persist-draft-portfolio-targets.md)
- [Replace Ingestion Event Sourcing With Run Ledger](./0x023.switch-event-sourcing-wrapper.md)
- [Show Bitcoin Beta For The Active Portfolio](./0x00b.show-bitcoin-beta-for-active-portfolio.md)
- [Add Read-Only Bitcoin Addresses](./0x00c.add-read-only-bitcoin-addresses.md)

## Planned

- [Keep The App Deployed And Reachable](./0x008.keep-app-deployed-and-reachable.md)
- [Serve The App From A Domain](./0x009.serve-app-from-domain.md)
- [Verify Deployed Hyperliquid Long-Short Rebalancing](./0x00a.verify-deployed-hyperliquid-long-short-rebalancing.md)
- [Include Read-Only Bitcoin Holdings In Beta](./0x00d.include-read-only-bitcoin-holdings-in-beta.md)
- [Target Ending Bitcoin Beta While Hedging](./0x00e.target-ending-bitcoin-beta-while-hedging.md)
- [Authenticate Portfolio Ownership By Solana Pubkey](./0x00f.authenticate-portfolio-ownership-by-solana-pubkey.md)
- [View Portfolios By Public Key URL](./0x010.view-portfolios-by-public-key-url.md)
- [Hide Portfolio Details For A Fee](./0x011.hide-portfolio-details-for-fee.md)
- [Add Read-Only Wallets On Other Chains](./0x012.add-read-only-wallets-on-other-chains.md)
- [Enter Protective Put Positions](./0x013.enter-protective-put-positions.md)
- [Simulate Historical Bitcoin Crashes](./0x014.simulate-historical-bitcoin-crashes.md)
- [Simulate Stressed Crash Correlations](./0x015.simulate-stressed-crash-correlations.md)
- [Roll Protective Puts Before Final Month](./0x016.roll-protective-puts-before-final-month.md)
- [Deposit Into Vault](./0x017.deposit-into-vault.md)
- [Withdraw From Vault](./0x018.withdraw-from-vault.md)
- [Use Derive Options For Protective Puts](./0x019.use-derive-options-for-protective-puts.md)
- [Compare Target vs Current Portfolio](./0x01a.compare-target-vs-current-portfolio.md)
- [Show Risk Analytics For Active Portfolio](./0x01b.show-risk-analytics-for-active-portfolio.md)
- [Screen Perps By Factor](./0x01c.screen-perps-by-factor.md)
- [Simulate Staged Portfolio Metrics](./0x01d.simulate-staged-portfolio-metrics.md)
- [Trade Hyperliquid Spot Positions](./0x01e.trade-hyperliquid-spot-positions.md)
- [Protocol Revenue Buybacks](./0x01f.protocol-revenue-buybacks.md)
- [Transparent Fee Calculations](./0x020.transparent-fee-calculations.md)
- [Participate In Governance](./0x021.participate-in-governance.md)
- [Earn Bounties For Contributions](./0x022.earn-bounties-for-contributions.md)
- [Sync Encrypted Local State Across Devices](./0x024.sync-encrypted-local-state.md)

## Dev
