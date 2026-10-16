// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Metadata} from "./Types.sol";

/// @notice Length limits for campaign metadata.
library MetadataLib {
    error InvalidMetadata();

    uint256 internal constant MAX_TITLE = 100;
    uint256 internal constant MAX_DESCRIPTION = 5000;
    uint256 internal constant MAX_IMAGE_URL = 500;
    uint256 internal constant MAX_LINKS = 5;
    uint256 internal constant MAX_LINK = 200;

    /// @dev Reverts InvalidMetadata unless: title is 1 to 100 bytes, description is at most
    /// 5000 bytes, imageUrl is empty or starts with "https://" and is at most 500 bytes, and
    /// there are at most 5 links, each starting with "https://" and at most 200 bytes.
    function validate(Metadata calldata meta) internal pure {
        uint256 titleLen = bytes(meta.title).length;
        if (titleLen == 0 || titleLen > MAX_TITLE) revert InvalidMetadata();
        if (bytes(meta.description).length > MAX_DESCRIPTION) revert InvalidMetadata();

        bytes calldata image = bytes(meta.imageUrl);
        if (image.length != 0) {
            if (image.length < 8 || image.length > MAX_IMAGE_URL) revert InvalidMetadata();
            // forge-lint: disable-next-line(unsafe-typecast)
            if (bytes8(image[:8]) != bytes8("https://")) revert InvalidMetadata();
        }

        uint256 n = meta.links.length;
        if (n > MAX_LINKS) revert InvalidMetadata();
        // forge-lint: disable-start(require-revert-in-loop)
        for (uint256 i = 0; i < n; ++i) {
            bytes calldata link = bytes(meta.links[i]);
            if (link.length < 8 || link.length > MAX_LINK) revert InvalidMetadata();
            // forge-lint: disable-next-line(unsafe-typecast)
            if (bytes8(link[:8]) != bytes8("https://")) revert InvalidMetadata();
        }
        // forge-lint: disable-end(require-revert-in-loop)
    }
}
