const dockerode = require('dockerode');

class Docker {
    constructor(options) {
        this.logger = options.logger;

        this.docker = new dockerode();
        this.image = 'archwaynetwork/archwayd';
        this.volume = 'vol_spinarch';
    }

    async pull() {
        this.logger.app(`Pulling image ${this.image}...`);

        const docker = this.docker;
        const image = this.image;
        return new Promise(function(resolve, reject) {
            return docker.pull(image, function(err, stream) {
                if (err) {
                    return reject(err);
                }

                stream.on('data', function(data) {
                    logger.docker(data.status);
                });

                stream.on('end', function() {
                    return resolve();
                });
            });
        });
    }

    async volume_exists() {
        const volume_name = this.volume;
        const out = await this.docker.listVolumes();
        const volume = out.Volumes.find(function(volume) {
            return volume.Name === volume_name;
        });

        return !!volume;
    }

    async remove_volume() {
        if (!(await this.volume_exists())) return;

        try {
            const volume = await this.docker.getVolume(this.volume);
            await volume.remove();
        } catch (err) {
            this.logger.docker(err);
        }
    }
}

module.exports = Docker;
