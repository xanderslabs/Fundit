// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Base} from "../helpers/Base.t.sol";
import {Campaign} from "../../src/Campaign.sol";
import {CampaignHandler} from "./CampaignHandler.sol";

contract CampaignInvariantsTest is Base {
    uint256 internal constant BPS = 10_000;

    Campaign internal campaign;
    CampaignHandler internal handler;

    function setUp() public override {
        super.setUp();
        campaign = Campaign(_create(IERC20(address(usdc)), 1_000e6));
        handler = new CampaignHandler(campaign, usdc, eurc, treasury);

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = CampaignHandler.donate.selector;
        selectors[1] = CampaignHandler.bridgeIn.selector;
        selectors[2] = CampaignHandler.settle.selector;
        selectors[3] = CampaignHandler.withdrawArc.selector;
        selectors[4] = CampaignHandler.withdrawCctp.selector;
        selectors[5] = CampaignHandler.claimFees.selector;
        selectors[6] = CampaignHandler.toggleTreasuryBlocked.selector;
        selectors[7] = CampaignHandler.strayTransfer.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    // Every campaign token held is either owed to the creator, owed to the treasury, or
    // waiting to be settled. Nothing can be stranded or double-counted.
    // Because unaccounted() saturates at zero, this is a solvency check: balance >= creatorBalance + feesAccrued.
    function invariant_BalanceMatchesBooks() public view {
        assertEq(
            usdc.balanceOf(address(campaign)),
            campaign.creatorBalance() + campaign.feesAccrued() + campaign.unaccounted()
        );
    }

    // No campaign token is created or lost: whatever came in is still held, was paid to the
    // creator's recipient, or was paid to the treasury.
    function invariant_Conservation() public view {
        assertEq(
            handler.ghostInflows(),
            usdc.balanceOf(address(campaign)) + handler.ghostPaidOut() + handler.ghostFeesClaimed()
        );
    }

    // The progress bar must never move backwards, whatever the creator withdraws or the
    // treasury claims.
    function invariant_RaisedNeverDecreases() public view {
        assertFalse(handler.raisedDecreased());
    }

    // The platform never takes more than the fees snapshotted at creation, and the fees
    // the events report are exactly what the books hold or the treasury received.
    function invariant_FeesWithinSnapshot() public view {
        assertLe(handler.ghostDonationFees(), campaign.grossDonated() * DONATION_FEE_BPS / BPS);
        assertLe(handler.ghostWithdrawFees(), campaign.withdrawn() * WITHDRAW_FEE_BPS / BPS);
        assertEq(
            campaign.feesAccrued() + handler.ghostFeesClaimed(),
            handler.ghostDonationFees() + handler.ghostTips() + handler.ghostWithdrawFees()
        );
    }

    // A stray EURC transfer must never be booked by a USDC campaign: every booked or
    // pending gross donation traces back to a campaign-token inflow that was not a tip.
    function invariant_StrayTokenNotBooked() public view {
        assertEq(campaign.grossDonated() + campaign.unaccounted() + handler.ghostTips(), handler.ghostInflows());
    }
}
