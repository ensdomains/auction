const NameAuction = artifacts.require("./NameAuction");

const DAY = 24 * 60 * 60;

module.exports = function(deployer, network, accounts) {
    return deployer.then(async () => {
        var now = new Date().getTime() / 1000;
        var bidStart = now + 1 * DAY;
        var revealStart = bidStart + 28 * DAY;
        var revealEnd = revealStart + 14 * DAY;
        await deployer.deploy(NameAuction, bidStart, revealStart, revealEnd, accounts[1]);
    });
};
