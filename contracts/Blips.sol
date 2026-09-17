// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Blips
/// @notice Base ERC-721 for paid 4.44s shorties. v2 mill — fossil is 0x9782…fDDBd.
/// @dev Minter-only mint. Hangar HTTPS tokenURI on day one; owner setTokenURI for ipfs later.
contract Blips {
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event MetadataUpdate(uint256 indexed tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    event RoyaltySet(address indexed receiver, uint96 bps);

    bytes4 private constant _ERC165 = 0x01ffc9a7;
    bytes4 private constant _ERC721 = 0x80ac58cd;
    bytes4 private constant _ERC721_METADATA = 0x5b5e139f;
    bytes4 private constant _ERC721_ENUMERABLE = 0x780e9d63;
    bytes4 private constant _ERC2981 = 0x2a55205a;
    bytes4 private constant _ERC4906 = 0x49064906;
    bytes4 private constant _ERC721_RECEIVED = 0x150b7a02;

    string public constant name = "Blips";
    string public constant symbol = "BLIP";

    address public owner;
    address public minter;
    uint256 public totalSupply;
    address public royaltyReceiver;
    uint96 public royaltyBps;

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
    error UnsafeRecipient();
    error RoyaltyTooHigh();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address minter_, address royaltyReceiver_, uint96 royaltyBps_) {
        if (minter_ == address(0) || royaltyReceiver_ == address(0)) revert InvalidAddress();
        if (royaltyBps_ > 1000) revert RoyaltyTooHigh();
        owner = msg.sender;
        minter = minter_;
        royaltyReceiver = royaltyReceiver_;
        royaltyBps = royaltyBps_;
        emit RoyaltySet(royaltyReceiver_, royaltyBps_);
    }

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert InvalidAddress();
        owner = next;
    }

    function setMinter(address minter_) external onlyOwner {
        if (minter_ == address(0)) revert InvalidAddress();
        minter = minter_;
    }

    function setRoyalty(address receiver, uint96 bps) external onlyOwner {
        if (receiver == address(0)) revert InvalidAddress();
        if (bps > 1000) revert RoyaltyTooHigh();
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltySet(receiver, bps);
    }

    function setTokenURI(uint256 tokenId, string calldata uri) external onlyOwner {
        if (_ownerOf[tokenId] == address(0)) revert TokenMissing();
        _tokenURI[tokenId] = uri;
        emit MetadataUpdate(tokenId);
    }

    /// @notice tokenId == mintIndex == totalSupply before increment. No burn.
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
        emit MetadataUpdate(tokenId);
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

    /// @dev Sequential ids, no burn ⇒ tokenByIndex(i) == i.
    function tokenByIndex(uint256 index) external view returns (uint256) {
        if (index >= totalSupply) revert TokenMissing();
        return index;
    }

    function tokenOfOwnerByIndex(address account, uint256 index) external view returns (uint256) {
        if (index >= _ownedTokens[account].length) revert TokenMissing();
        return _ownedTokens[account][index];
    }

    function royaltyInfo(uint256, uint256 salePrice) external view returns (address, uint256) {
        return (royaltyReceiver, (salePrice * royaltyBps) / 10000);
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
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        _transfer(from, to, tokenId);
        _checkOnReceived(msg.sender, from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        _transfer(from, to, tokenId);
        _checkOnReceived(msg.sender, from, to, tokenId, data);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == _ERC165
            || interfaceId == _ERC721
            || interfaceId == _ERC721_METADATA
            || interfaceId == _ERC721_ENUMERABLE
            || interfaceId == _ERC2981
            || interfaceId == _ERC4906;
    }

    function _transfer(address from, address to, uint256 tokenId) private {
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

    function _checkOnReceived(address operator, address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        (bool ok, bytes memory ret) = to.call(
            abi.encodeWithSelector(_ERC721_RECEIVED, operator, from, tokenId, data)
        );
        if (!ok || ret.length != 32 || bytes4(ret) != _ERC721_RECEIVED) revert UnsafeRecipient();
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
