const NameAuction = artifacts.require('./NameAuction');
const Promise = require('bluebird');
const sha3 = require('web3-utils').sha3;

const advanceTime = Promise.promisify(function(delay, done) {
	web3.currentProvider.sendAsync({
		jsonrpc: "2.0",
		"method": "evm_increaseTime",
		params: [delay]}, done)
});

const SECRET = sha3("foo");
const DAY = 24 * 60 * 60;

async function expectFailure(call) {
    let tx;
	try {
		tx = await call;
	} catch (error) {
      // Assert ganache revert exception
      assert.equal(
        error.message,
        'VM Exception while processing transaction: revert'
      );
	}
    if(tx !== undefined) {
        assert.equal(parseInt(tx.receipt.status), 0);
    }
}

contract('NameAuction', function(accounts) {

	const firstbid = {account: accounts[1], name: "test", value: 1};
	const higherbid = {account: accounts[2], name: "test", value: 2};
	const midbid = {account: accounts[3], name: "test", value: 1.5};
	const lowbid = {account: accounts[4], name: "test", value: 1};
	const longbid = {account: accounts[1], name: "toolong", value: 1};
	const latebid = {account: accounts[1], name: "late", value: 1};
	const bids = [firstbid, higherbid, midbid, lowbid, longbid];

	let nameauction;
	let minbid;

	before(async() => {
		nameauction = await NameAuction.deployed();
		minbid = await nameauction.MIN_BID();
	});


	it('Calculates bid hashes', async() => {
		for(let bid of bids) {
			bid.hash = await nameauction.computeBidHash(bid.account, bid.name, SECRET);
		}
		latebid.hash = await nameauction.computeBidHash(latebid.account, latebid.name, SECRET);
	});

	it('Does not allow bids before the start time', async() => {
		await expectFailure(nameauction.placeBid(firstbid.hash, {value: 1e18}));
	});

	it('Advances time to the bidding period', async() => {
		await advanceTime(1 * DAY);
	});

	it('Forbids bids below the minimum', async() => {
		var bid = (await nameauction.MIN_BID()).sub(1);
		await expectFailure(nameauction.placeBid(firstbid.hash, {value: bid}));
	});

	it('Permits valid bids during the bidding period', async() => {
		for(let bid of bids) {
			var value = minbid.times(bid.value);
			await nameauction.placeBid(bid.hash, {value: value});
			assert.equal((await nameauction.bids(bid.hash)).toString(), value.toString());
		}
	});

	it('Forbids duplicate bids', async() => {
		await expectFailure(nameauction.placeBid(firstbid.hash, {value: await nameauction.MIN_BID()}));
	});

	it('Forbids early reveals', async() => {
		await expectFailure(nameauction.revealBid(firstbid.account, firstbid.name, SECRET));
	});

	it('Advances time to the reveal period', async() => {
		await advanceTime(28 * DAY);
	});

	it('Forbids late bids', async() => {
		await expectFailure(nameauction.placeBid(latebid.hash,  {value: minbid}));
	});

	it('Rejects invalid reveals', async() => {
		await expectFailure(nameauction.revealBid(latebid.account, latebid.name, SECRET));
	});

	it('Returns bids on invalid length names', async() => {
		const balanceBefore = await web3.eth.getBalance(accounts[1]);
		await nameauction.revealBid(longbid.account, longbid.name, SECRET);
		const returned = (await web3.eth.getBalance(accounts[1])).sub(balanceBefore);
		assert.equal(returned.toString(), (await nameauction.MIN_BID()).toString());
	});

	it('Handles the first reveal correctly', async() => {
		await nameauction.revealBid(firstbid.account, firstbid.name, SECRET);
		const auction = await nameauction.auction(firstbid.name);
		assert.equal(auction[0].toString(), minbid.times(firstbid.value).toString());
		assert.equal(auction[1].toString(), "0");
		assert.equal(auction[2], firstbid.account);
	});

	it('Handles a higher bid reveal correctly', async() => {
		const balanceBefore = await web3.eth.getBalance(firstbid.account);

		await nameauction.revealBid(higherbid.account, higherbid.name, SECRET);
		const auction = await nameauction.auction(higherbid.name);

		// Check max bid, second bid, and winner are set correctly
		assert.equal(auction[0].toString(), minbid.times(higherbid.value).toString());
		assert.equal(auction[1].toString(), minbid.times(firstbid.value).toString());
		assert.equal(auction[2], higherbid.account);

		// Check first bidder has their bid returned
		assert.equal((await web3.eth.getBalance(firstbid.account)).toString(), balanceBefore.add(minbid.times(firstbid.value)).toString());
	});

	it('Handles a bid that updates the second bid price correctly', async() => {
		const balanceBefore = await web3.eth.getBalance(midbid.account);

		await nameauction.revealBid(midbid.account, midbid.name, SECRET);
		const auction = await nameauction.auction(midbid.name);

		// Check max bid, second bid, and winner are set correctly
		assert.equal(auction[0].toString(), minbid.times(higherbid.value).toString());
		assert.equal(auction[1].toString(), minbid.times(midbid.value).toString());
		assert.equal(auction[2], higherbid.account);

		// Check bidder has their bid returned
		assert.equal((await web3.eth.getBalance(midbid.account)).toString(), balanceBefore.add(minbid.times(midbid.value)).toString());
	});

	it('Handles a bid that is below the second price correctly', async() => {
		const balanceBefore = await web3.eth.getBalance(lowbid.account);

		await nameauction.revealBid(lowbid.account, lowbid.name, SECRET);
		const auction = await nameauction.auction(lowbid.name);

		// Check max bid, second bid, and winner are set correctly
		assert.equal(auction[0].toString(), minbid.times(higherbid.value).toString());
		assert.equal(auction[1].toString(), minbid.times(midbid.value).toString());
		assert.equal(auction[2], higherbid.account);

		// Check bidder has their bid returned
		assert.equal((await web3.eth.getBalance(lowbid.account)).toString(), balanceBefore.add(minbid.times(lowbid.value)).toString());
	});

	it('Rejects early finalisations', async() => {
		await expectFailure(nameauction.finaliseAuction(firstbid.name));
	});

	it('Advances time to the finalisation period', async() => {
		await advanceTime(14 * DAY);
	});

	it('Permits finalising an auction', async() => {
		const auction = await nameauction.auction(firstbid.name);
		const balanceBefore = await web3.eth.getBalance(higherbid.account);
		await nameauction.finaliseAuction(firstbid.name);

		// Check the auction struct gets zeroed out
		const auctionAfter = await nameauction.auction(firstbid.name);
		assert.equal(auctionAfter[0].toString(), "0");
		assert.equal(auctionAfter[1].toString(), "0");
		assert.equal(auctionAfter[2], "0x0000000000000000000000000000000000000000");

		// Check the owner gets updated
		assert.equal(await nameauction.labelOwner(firstbid.name), higherbid.account);

		// Check the funds available get updated
		assert.equal((await nameauction.fundsAvailable()).toString(), auction[1].toString());

		// Check the winning bidder is refunded the difference between their bid and the next highest
		assert.equal((await web3.eth.getBalance(higherbid.account)).toString(), balanceBefore.add(auction[0].sub(auction[1])).toString());
	});

	it('Rejects finalisations for auctions with no bids', async() => {
		await expectFailure(nameauction.finaliseAuction("blah"));
	});

	it('Does not permit others to withdraw auction proceeds', async() => {
		await expectFailure(nameauction.withdraw({from: accounts[1]}));
	});

	it('Permits the owner to withdraw auction proceeds', async() => {
		const balanceBefore = await web3.eth.getBalance(accounts[0]);
		const availableBefore = await nameauction.fundsAvailable();

		await nameauction.withdraw({gasPrice: 0});

		assert.equal((await web3.eth.getBalance(accounts[0])).toString(), balanceBefore.add(availableBefore));
		assert.equal((await nameauction.fundsAvailable()).toString(), "0");
	});
	});
