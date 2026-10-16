// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Campaign display data. Limits are enforced by MetadataLib.validate.
struct Metadata {
    string title;
    string description;
    string imageUrl;
    string[] links;
}

/// @notice Everything the frontend needs to render one campaign, in a single call.
struct Summary {
    address creator;
    address token;
    uint256 goal;
    uint256 raised;
    uint256 available;
    uint256 withdrawn;
    bool closed;
    uint16 donationFeeBps;
    uint16 withdrawFeeBps;
    uint64 createdAt;
    Metadata meta;
}
