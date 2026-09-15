// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Blips
/// @notice Base ERC-721 collection for paid 4.44s Blips. NEW collection — not GRVR / ERC-8004.
/// @dev Clearing x402 settle gates mint via `minter`. tokenURI → 4.44s media + receipt fields.
///      mintIndex for the hangar escalator is this contract's `totalSupply()` (settled paid count).
contract Blips {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    string public constant name = "Blips";
    string public constant symbol = "BLIP";

    address public owner;
    address public minter;
    uint256 public totalSupply;

    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) private _tokenApproval;
    mapping(address => mapping(address => bool)) private _operatorApproval;
    mapping(uint256 => string) private _tokenURI;
    mapping(address => uint256[]) private _ownedTokens;

    error NotOwner();
    error NotMinter();
    error NotTokenOwner();
    error InvalidAddress();
    error TokenMissing();
    error NotApproved();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address minter_) {
        if (minter_ == address(0)) revert InvalidAddress();
        owner = msg.sender;
        minter = minter_;
    }

    function setMinter(address minter_) external onlyOwner {
        if (minter_ == address(0)) revert InvalidAddress();
        minter = minter_;
    }

    /// @notice Mint the next token to `to`. tokenId == mintIndex == totalSupply before increment.
    function mint(address to, string calldata uri) external returns (uint256 tokenId) {
        if (msg.sender != minter) revert NotMinter();
        if (to == address(0)) revert InvalidAddress();
        tokenId = totalSupply;
        _ownerOf[tokenId] = to;
        _balanceOf[to] += 1;
        _tokenURI[tokenId] = uri;
        _ownedTokens[to].push(tokenId);
        totalSupply += 1;
        emit Transfer(address(0), to, tokenId);
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        if (_ownerOf[tokenId] == address(0)) revert TokenMissing();
        return _tokenURI[tokenId];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address o = _ownerOf[tokenId];
        if (o == address(0)) revert TokenMissing();
        return o;
    }

    function balanceOf(address account) public view returns (uint256) {
        if (account == address(0)) revert InvalidAddress();
        return _balanceOf[account];
    }

    function tokenOfOwnerByIndex(address account, uint256 index) external view returns (uint256) {
        if (index >= _ownedTokens[account].length) revert TokenMissing();
        return _ownedTokens[account][index];
    }

    function approve(address approved, uint256 tokenId) external {
        address o = ownerOf(tokenId);
        if (msg.sender != o && !_operatorApproval[o][msg.sender]) revert NotApproved();
        _tokenApproval[tokenId] = approved;
        emit Approval(o, approved, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        if (_ownerOf[tokenId] == address(0)) revert TokenMissing();
        return _tokenApproval[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApproval[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return _operatorApproval[account][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert InvalidAddress();
        address o = ownerOf(tokenId);
        if (o != from) revert NotTokenOwner();
        if (msg.sender != o && msg.sender != _tokenApproval[tokenId] && !_operatorApproval[o][msg.sender]) {
            revert NotApproved();
        }
        _tokenApproval[tokenId] = address(0);
        _balanceOf[from] -= 1;
        _balanceOf[to] += 1;
        _ownerOf[tokenId] = to;
        _removeOwned(from, tokenId);
        _ownedTokens[to].push(tokenId);
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata) external {
        transferFrom(from, to, tokenId);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f || interfaceId == 0x01ffc9a7;
    }

    function _removeOwned(address account, uint256 tokenId) private {
        uint256[] storage list = _ownedTokens[account];
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == tokenId) {
                list[i] = list[list.length - 1];
                list.pop();
                return;
            }
        }
    }
}
