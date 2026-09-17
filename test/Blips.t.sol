// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Blips} from "../contracts/Blips.sol";

contract BlipsTest {
    function testMintEnumerableRoyaltyUri() public {
        Blips nft = new Blips(address(this), address(this), 500);
        address buyer = address(0xA11CE);
        uint256 id = nft.mint(buyer, "https://hangar/meta/0");
        require(id == 0, "id");
        require(nft.totalSupply() == 1, "supply");
        require(nft.tokenByIndex(0) == 0, "tokenByIndex");
        require(nft.tokenOfOwnerByIndex(buyer, 0) == 0, "ownedIndex");
        require(nft.supportsInterface(bytes4(0x780e9d63)), "enumerable");
        require(nft.supportsInterface(bytes4(0x2a55205a)), "2981");
        require(nft.supportsInterface(bytes4(0x49064906)), "4906");
        (address recv, uint256 amt) = nft.royaltyInfo(0, 10_000);
        require(recv == address(this), "recv");
        require(amt == 500, "bps");
        nft.setTokenURI(0, "ipfs://cid");
        require(keccak256(bytes(nft.tokenURI(0))) == keccak256("ipfs://cid"), "uri");
    }

    function testNonMinterCannotMint() public {
        Blips nft = new Blips(address(0xB0B), address(this), 500);
        (bool ok,) = address(nft).call(abi.encodeWithSelector(Blips.mint.selector, address(this), "x"));
        require(!ok, "should revert");
    }
}
