docker build --tag insteon-assist . && docker run -d --name=insteon-assist --net host --restart unless-stopped insteon-assist
