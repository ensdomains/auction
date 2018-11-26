pragma solidity ^0.4.24;

contract NameAuction {

    struct Auction {
        uint maxBid;
        uint secondBid;
        address winner;
    }

    uint public constant MIN_BID = 0.01 ether;
    uint public constant MIN_NAME_LENGTH = 3;
    uint public constant MAX_NAME_LENGTH = 6;

    address public owner;
    address public beneficiary;

    uint public biddingStarts;
    uint public biddingEnds;
    uint public revealEnds;
    uint public fundsAvailable;

    mapping(bytes32=>uint) public bids;
    mapping(string=>Auction) auctions;
    mapping(string=>address) labels;

    event BidPlaced(address indexed bidder, uint amount, bytes32 hash);
    event BidRevealed(address indexed bidder, bytes32 indexed labelHash, string label, uint amount);
    event AuctionFinalised(address indexed winner, bytes32 indexed labelHash, string label, uint amount);

    constructor(uint _biddingStarts, uint _biddingEnds, uint _revealEnds, address _beneficiary) public {
        require(_biddingStarts >= now);
        require(_biddingEnds > _biddingStarts);
        require(_revealEnds > _biddingEnds);
        require(_beneficiary != 0);

        owner = msg.sender;
        biddingStarts = _biddingStarts;
        biddingEnds = _biddingEnds;
        revealEnds = _revealEnds;
        beneficiary = _beneficiary;
    }

    function placeBid(bytes32 bidHash) external payable {
        require(now >= biddingStarts && now < biddingEnds);

        require(msg.value >= MIN_BID);
        require(bids[bidHash] == 0);
        bids[bidHash] = msg.value;
        emit BidPlaced(msg.sender, msg.value, bidHash);
    }

    function revealBid(address bidder, string label, bytes32 secret) external {
        require(now >= biddingEnds && now < revealEnds);

        bytes32 bidHash = computeBidHash(bidder, label, secret);
        uint bidAmount = bids[bidHash];
        bids[bidHash] = 0;
        require(bidAmount > 0);

        // Immediately refund bids on invalid labels.
        uint labelLen = strlen(label);
        if(labelLen < MIN_LABEL_LENGTH || labelLen > MAX_LABEL_LENGTH) {
            bidder.transfer(bidAmount);
            return;
        }

        emit BidRevealed(bidder, keccak256(abi.encodePacked(label)), label, bidAmount);

        Auction storage a = auctions[label];
        if(bidAmount > a.maxBid) {
            // New winner!
            if(a.winner != 0) {
                // Ignore failed sends - bad luck for them.
                a.winner.send(a.maxBid);
            }
            a.secondBid = a.maxBid;
            a.maxBid = bidAmount;
            a.winner = bidder;
        } else if(bidAmount > a.secondBid) {
            // New second bidder
            a.secondBid = bidAmount;
            bidder.transfer(bidAmount);
        } else {
            // No effect on the auction
            bidder.transfer(bidAmount);
        }
    }

    function finaliseAuction(string label) external {
        require(now >= revealEnds);

        Auction storage auction = auctions[label];
        require(auction.winner != 0);

        uint winPrice = auction.secondBid;
        if(winPrice == 0) {
            winPrice = MIN_BID;
        }
        if(winPrice < auction.maxBid) {
            // Ignore failed sends
            auction.winner.send(auction.maxBid - winPrice);
        }
        fundsAvailable += winPrice;

        emit AuctionFinalised(auction.winner, keccak256(abi.encodePacked(label)), label, winPrice);

        labels[label] = auction.winner;
        delete auctions[label];
    }

    function withdraw() external {
        require(msg.sender == owner);
        msg.sender.transfer(fundsAvailable);
        fundsAvailable = 0;
    }

    function auction(string name) external view returns(uint maxBid, uint secondBid, address winner) {
        Auction storage a = auctions[name];
        return (a.maxBid, a.secondBid, a.winner);
    }

    function nameOwner(string name) external view returns(address) {
        return names[name];
    }

    function computeBidHash(address bidder, string name, bytes32 secret) public pure returns(bytes32) {
        return keccak256(abi.encodePacked(bidder, name, secret));
    }

    /**
     * @dev Returns the length of a given string
     *
     * @param s The string to measure the length of
     * @return The length of the input string
     */
    function strlen(string s) internal pure returns (uint) {
        s; // Don't warn about unused variables
        // Starting here means the LSB will be the byte we care about
        uint ptr;
        uint end;
        assembly {
            ptr := add(s, 1)
            end := add(mload(s), ptr)
        }
        for (uint len = 0; ptr < end; len++) {
            uint8 b;
            assembly { b := and(mload(ptr), 0xFF) }
            if (b < 0x80) {
                ptr += 1;
            } else if (b < 0xE0) {
                ptr += 2;
            } else if (b < 0xF0) {
                ptr += 3;
            } else if (b < 0xF8) {
                ptr += 4;
            } else if (b < 0xFC) {
                ptr += 5;
            } else {
                ptr += 6;
            }
        }
        return len;
    }
}
